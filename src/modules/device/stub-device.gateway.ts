import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { ConfigService } from '@nestjs/config';
import { MissingDeviceUserError } from './device.gateway';
import type {
  DeviceGateway,
  DeviceInfo,
  SetValidityInput,
  UpsertUserInput,
} from './device.gateway';

interface StubUser {
  employeeNo: number;
  name: string;
  begin: Date;
  end: Date;
  enable: boolean;
  /** Царай «бүртгэгдэх» цаг — `STUB_FACE_AUTO_ENROLL` секундын дараа. */
  faceAt: number;
}

/**
 * Төхөөрөмжгүйгээр хөгжүүлэх stub.
 *
 * ЗӨВХӨН «үргэлж амжилттай» биш байх нь чухал — эс тэгвээс outbox-ийн retry,
 * «синк алдаа» дэлгэц, offline анхааруулга зэрэг нь хэзээ ч туршигдахгүй,
 * жинхэнэ төхөөрөмж холбогдох өдөр л илэрнэ. Тиймээс:
 *
 *   STUB_FAILURE_RATE   — түр зуурын алдааны хувь (retry ажиллана)
 *   STUB_DEVICE_OFFLINE — бүх команд унана (offline анхааруулга)
 *   STUB_LATENCY_*      — бодит саатал
 */
@Injectable()
export class StubDeviceGateway implements DeviceGateway, OnModuleInit {
  private readonly log = new Logger(StubDeviceGateway.name);
  private readonly users = new Map<number, StubUser>();
  /** Экспортоос ачаалсан бодит эвент — `fetchEvents` эндээс өгнө. */
  private replayEvents: Record<string, unknown>[] = [];
  /** Экспортын төхөөрөмжийн мэдээлэл, байвал `info()` үүнийг буцаана. */
  private replayInfo: { model: string; firmware: string } | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * ЖИНХЭНЭ терминалаас татсан өгөгдлийг ачаална.
   *
   * ЯАГААД: хиймэл өгөгдөл нь firmware бүрд өөр байдаг талбар, эвентийн
   * код, нэрийн бүтцийг тааруулж чадахгүй. `npm run export-device`-ээр
   * татсан бодит файл нь 339 хэрэглэгч, 1,738 эвенттэй — терминалгүйгээр
   * бодит нөхцөлд хөгжүүлэх боломж өгнө.
   *
   * Файл байхгүй бол хоосон stub хэвээр ажиллана (алдаа биш).
   */
  onModuleInit(): void {
    if (this.config.get<string>('gateways.device') !== 'stub') return;
    const path = this.newestExport();
    if (!path) return;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as {
        device?: { model?: string; firmware?: string };
        users?: Record<string, unknown>[];
        faces?: Record<string, boolean>;
        events?: Record<string, unknown>[];
      };
      this.loadUsers(raw.users ?? [], raw.faces ?? {});
      this.replayEvents = raw.events ?? [];
      if (raw.device?.model) {
        this.replayInfo = {
          model: `${raw.device.model} (экспорт)`,
          firmware: raw.device.firmware ?? '—',
        };
      }
      this.log.log(
        `Экспортоос ачаалав: ${this.users.size} хэрэглэгч, ` +
          `${this.replayEvents.length} эвент — ${basename(path)}`,
      );
    } catch (e) {
      this.log.warn(`Экспорт уншиж чадсангүй: ${(e as Error).message}`);
    }
  }

  /** `export/` доторх ХАМГИЙН СҮҮЛИЙН файл. */
  private newestExport(): string | null {
    const dir = join(process.cwd(), 'export');
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('device-') && f.endsWith('.json'))
      .sort();
    return files.length ? join(dir, files[files.length - 1]) : null;
  }

  private loadUsers(
    rows: Record<string, unknown>[],
    faces: Record<string, boolean>,
  ): void {
    for (const u of rows) {
      // ⚠ `employeeNo` нь ТЕКСТ — «Adiya» гэсэн ч байж болно. Stub нь
      // тоон түлхүүртэй тул хөрвөхгүйг алгасна.
      const no = Number(u.employeeNo);
      if (!Number.isInteger(no) || no <= 0) continue;
      const v = (u.Valid ?? {}) as Record<string, string | boolean>;
      const parse = (x: unknown, fallback: Date): Date => {
        const d = typeof x === 'string' ? new Date(x) : null;
        return d && !Number.isNaN(d.getTime()) ? d : fallback;
      };
      this.users.set(no, {
        employeeNo: no,
        name: String(u.name ?? `№${no}`),
        begin: parse(v.beginTime, new Date()),
        end: parse(v.endTime, new Date()),
        enable: v.enable !== false,
        // Экспортод царайтай байсан бол ТЭР ДАРУЙ бүртгэлтэй гэж үзнэ.
        faceAt: faces[String(no)] ? 0 : Number.MAX_SAFE_INTEGER,
      });
    }
  }

  async upsertUser(input: UpsertUserInput): Promise<void> {
    await this.simulate('upsertUser', input.employeeNo);
    const existing = this.users.get(input.employeeNo);
    this.users.set(input.employeeNo, {
      ...input,
      // Дахин бичихэд царайн бүртгэл алдагдахгүй (жинхэнэ төхөөрөмж шиг).
      faceAt: existing?.faceAt ?? Date.now() + this.faceDelayMs(),
    });
  }

  async setValidity(input: SetValidityInput): Promise<void> {
    await this.simulate('setValidity', input.employeeNo);
    const u = this.users.get(input.employeeNo);
    if (!u) {
      // Жинхэнэ төхөөрөмж дээр ч ийм алдаа гарна (reset, гараар устгасан).
      // Дуудагч тал БҮТЭН upsert хийж нөхнө.
      throw new MissingDeviceUserError(input.employeeNo);
    }
    Object.assign(u, input);
  }

  async deleteUser(employeeNo: number): Promise<void> {
    await this.simulate('deleteUser', employeeNo);
    this.users.delete(employeeNo);
  }

  async faceStatus(employeeNos: number[]): Promise<Record<number, boolean>> {
    await this.simulate('faceStatus');
    const now = Date.now();
    const out: Record<number, boolean> = {};
    for (const no of employeeNos) {
      const u = this.users.get(no);
      out[no] = !!u && now >= u.faceAt;
    }
    return out;
  }

  async openDoor(doorNo = 1): Promise<void> {
    await this.simulate('openDoor');
    this.log.log(`[STUB] Хаалга ${doorNo} нээгдэв`);
  }

  /**
   * Stub горимд ирц ТАТАХГҮЙ.
   *
   * Хуурамч эвент үүсгэвэл хөгжүүлэлтийн санд утгагүй ирц хуримтлагдаж,
   * тайлан худал болно. Ирцийг турших бол `/access-events/simulate`
   * ашиглана — тэр нь ЗОРИУДААР дуудагдана.
   */
  /**
   * Экспортоос ачаалсан бодит эвентийг ЗААСАН ЦОНХОНД тааруулж буцаана.
   *
   * ⚠ Огноог нь ШИЛЖҮҮЛНЭ: экспорт нь 8-р сарын өгөгдөл тул хэвээр нь
   * буцаавал татагч «цонхонд юу ч алга» гэж үзнэ. Хамгийн сүүлийн
   * эвентийг ОДОО болгож бүгдийг хойш нь шилжүүлж, цонхонд таарсныг л
   * өгнө — ингэснээр татагчийн логик бодитоор туршигдана.
   */
  async fetchEvents(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    await this.simulate('fetchEvents');
    if (!this.replayEvents.length) return [];

    const times = this.replayEvents
      .map((e) => new Date(String(e.time ?? '')).getTime())
      .filter((t) => !Number.isNaN(t));
    if (!times.length) return [];
    const shift = Date.now() - Math.max(...times);

    const out: Record<string, unknown>[] = [];
    for (const e of this.replayEvents) {
      const t = new Date(String(e.time ?? '')).getTime();
      if (Number.isNaN(t)) continue;
      const moved = new Date(t + shift);
      if (moved >= from && moved <= to) {
        out.push({ ...e, time: moved.toISOString() });
      }
    }
    return out;
  }

  async info(): Promise<DeviceInfo> {
    const offline = this.config.get<boolean>('stub.deviceOffline') ?? false;
    return {
      model: this.replayInfo?.model ?? 'DS-K1T320MFX (stub)',
      firmware: this.replayInfo?.firmware ?? 'V0.0.0-stub',
      online: !offline,
      capacity: { users: this.users.size, faces: this.users.size },
    };
  }

  /** Дотоод — туршилтад төхөөрөмжийн төлөвийг харах. */
  snapshot(): StubUser[] {
    return [...this.users.values()];
  }

  // ── Дуурайлгах ──

  private async simulate(op: string, employeeNo?: number): Promise<void> {
    if (this.config.get<boolean>('stub.deviceOffline')) {
      throw new Error('Терминал холбогдохгүй байна (stub: offline)');
    }
    await this.delay();
    const rate = this.config.get<number>('stub.failureRate') ?? 0;
    if (rate > 0 && Math.random() < rate) {
      throw new Error(`Терминал хариу өгсөнгүй (stub: түр зуурын алдаа, ${op})`);
    }
    this.log.debug(`[STUB] ${op}${employeeNo ? ` #${employeeNo}` : ''}`);
  }

  private delay(): Promise<void> {
    const min = this.config.get<number>('stub.latencyMinMs') ?? 0;
    const max = this.config.get<number>('stub.latencyMaxMs') ?? min;
    const ms = min + Math.random() * Math.max(0, max - min);
    return new Promise((r) => setTimeout(r, ms));
  }

  private faceDelayMs(): number {
    return (this.config.get<number>('stub.faceAutoEnrollSec') ?? 30) * 1000;
  }
}
