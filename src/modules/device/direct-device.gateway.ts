import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermanentError } from '../outbox/outbox.errors';
import { DeviceConnectionService } from './device-connection.service';
import {
  DigestAuthError,
  IsapiClient,
  IsapiError,
  IsapiUserNotFound,
} from './isapi/isapi.client';
import {
  MissingDeviceUserError,
  type DeviceGateway,
  type DeviceInfo,
  type SetValidityInput,
  type DeviceUserRow,
  type UpsertUserInput,
} from './device.gateway';

/**
 * Терминалын `2026-04-25T23:59:59` хэлбэрийг ОРОН НУТГИЙН цагаар уншина.
 *
 * ⚠ `new Date(str)` нь бүсийн тэмдэггүй мөрийг орчноос хамааран UTC
 * эсвэл local гэж уншдаг. Терминал `timeType: 'local'` гэж бичдэг тул
 * заавал local гэж задлана — эс бөгөөс огноо 8 цагаар гулсаж, тулгалт
 * бүх хэрэглэгчийг «зөрүүтэй» гэж буруу дуудна.
 */
function parseLocal(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(String(v ?? ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m.map(Number) as unknown as number[];
  return new Date(y, mo - 1, d, h, mi, sec);
}

/**
 * Терминалтай ШУУД ярих gateway — backend нь терминалтай НЭГ LAN дотор.
 *
 * Хэрэглээ:
 *  • Хөгжүүлэлт — зөөврийн компьютер фитнесийн WiFi-д холбогдсон үед
 *  • Backend нь заалан дээр ажилладаг болвол ашиглалтад ч болно
 *
 * Үүлэн дээр байрлах backend-д ТОХИРОХГҮЙ — тэнд `agent` горим хэрэгтэй
 * (NAT-ын ард дотогш холбогдох боломжгүй, docs/04-agent-design.md).
 */
@Injectable()
export class DirectDeviceGateway implements DeviceGateway, OnModuleInit {
  private readonly log = new Logger(DirectDeviceGateway.name);
  private client: IsapiClient | null = null;

  /** Хаяг солигдоход дахин хайхыг хэт олон дахин эхлүүлэхгүй. */
  private rediscovering: Promise<boolean> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly address: DeviceConnectionService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('gateways.device') !== 'direct') return;
    await this.connect();
  }

  /**
   * Хаягийг DB → `.env` эрэмбээр авч клиент үүсгэнэ.
   *
   * ЯАГААД DB ТҮРҮҮЛЭХ ВЭ: фитнесийн router DHCP-ээр хаяг тарааж,
   * терминалын IP хугацаа өнгөрөхөд СОЛИГДДОГ. Автоматаар олоод DB-д
   * бичсэн хаяг нь `.env`-ийнхээс үргэлж шинэ байна.
   */
  private async connect(): Promise<boolean> {
    const cfg = await this.address.connection();
    if (!cfg) {
      this.log.error('Терминалын хаяг тодорхойгүй — DB болон HIK_HOST хоосон');
      this.client = null;
      return false;
    }
    this.client = new IsapiClient({ ...cfg, timeoutMs: 15_000 });
    this.log.log(`Терминалтай шууд холбогдоно: ${this.client.address}`);
    return true;
  }

  /**
   * Тохиргоо ДЭЛГЭЦЭЭС өөрчлөгдсөн үед клиентийг дахин үүсгэнэ.
   *
   * ⚠ Клиент нь тохиргоог үүсгэх үедээ ХУУЛЖ авдаг. Дахин үүсгэхгүй бол
   * ажилтан шинэ нууц үг хадгалсан ч сервер дахин асах хүртэл хуучнаар
   * ярьсаар байх бөгөөд буруу нууц үгийн тоолуур өсч, терминал IP-г
   * блоклоно.
   */
  async reconnect(): Promise<boolean> {
    return this.connect();
  }

  /**
   * Хаяг солигдсон байж магадгүй — дэд сүлжээг сканнердаж дахин холбоно.
   *
   * ⚠ Зэрэг олон дуудлага унавал НЭГ л сканнер явуулна: 254 хаягийн
   * шалгалт хүнд бөгөөд давхар явуулбал сүлжээ боогдоно.
   */
  private rediscover(): Promise<boolean> {
    this.rediscovering ??= (async () => {
      const r = await this.address.discover();
      if (!r.chosen) return false;
      return this.connect();
    })().finally(() => {
      this.rediscovering = null;
    });
    return this.rediscovering;
  }

  private api(): IsapiClient {
    if (!this.client) {
      throw new PermanentError(
        'Терминалын холболт тохируулаагүй (HIK_HOST / HIK_USER / HIK_PASSWORD)',
      );
    }
    return this.client;
  }

  private get doorNo(): number {
    return this.config.get<number>('hikvision.doorNo') ?? 1;
  }

  private get planTemplateNo(): string {
    return this.config.get<string>('hikvision.planTemplateNo') ?? '1';
  }

  // ══════════════════════════════════════════════════════════════

  async upsertUser(input: UpsertUserInput): Promise<void> {
    await this.guard(async () => {
      const res = await this.api().upsertUser({
        employeeNo: input.employeeNo,
        name: input.name,
        beginTime: this.local(input.begin),
        endTime: this.local(input.end),
        enable: input.enable,
        doorNo: this.doorNo,
        planTemplateNo: this.planTemplateNo,
      });
      this.log.log(`Терминал: №${input.employeeNo} ${res}`);
    });
  }

  async setValidity(input: SetValidityInput): Promise<void> {
    await this.guard(async () => {
      try {
        await this.api().setValidity({
          employeeNo: input.employeeNo,
          // Modify нь бүтэн обьект хүлээдэг тул нэрийг терминалаас уншина.
          name: await this.nameOf(input.employeeNo),
          beginTime: this.local(input.begin),
          endTime: this.local(input.end),
          enable: input.enable,
          doorNo: this.doorNo,
          planTemplateNo: this.planTemplateNo,
        });
      } catch (e) {
        // Дуудагч тал бүтэн upsert хийж нөхнө (device-sync.service).
        if (e instanceof IsapiUserNotFound) {
          throw new MissingDeviceUserError(input.employeeNo);
        }
        throw e;
      }
    });
  }

  async deleteUser(employeeNo: number): Promise<void> {
    await this.guard(() => this.api().deleteUser(employeeNo));
  }

  async faceStatus(employeeNos: number[]): Promise<Record<number, boolean>> {
    return this.guard(() => this.api().faceStatus(employeeNos));
  }

  async listUsers(): Promise<DeviceUserRow[]> {
    return this.guard(async () => {
      const raw = await this.api().listUsers();
      return raw.map((u) => {
        const valid = (u.Valid ?? {}) as Record<string, unknown>;
        return {
          employeeNo: Number(u.employeeNo),
          name: String(u.name ?? ''),
          begin: parseLocal(valid.beginTime),
          end: parseLocal(valid.endTime),
          // Талбар байхгүй бол «идэвхтэй» гэж үзнэ — терминалын анхдагч.
          enable: valid.enable !== false,
        };
      });
    });
  }

  async openDoor(doorNo?: number): Promise<void> {
    await this.guard(() => this.api().openDoor(doorNo ?? this.doorNo));
  }

  /**
   * Хуудаслаж БҮГДИЙГ татна.
   *
   * ⚠ Нэг хуудсаар хязгаарлавал ачаалалтай өдөр эвент алдагдана: бодит
   * хэмжилтээр өдөрт ~248 эвент бүртгэгддэг.
   */
  async fetchEvents(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    return this.guard(async () => {
      const out: Record<string, unknown>[] = [];
      let pos = 0;
      for (;;) {
        const r = await this.api().fetchEvents(from, to, pos, 50);
        out.push(...(r.events as Record<string, unknown>[]));
        if (!r.events.length || out.length >= r.total) break;
        pos += r.events.length;
        // Хамгаалалт: гацахаас сэргийлнэ.
        if (pos > 5_000) break;
      }
      return out;
    });
  }

  async info(): Promise<DeviceInfo> {
    return this.guard(async () => {
      const d = await this.api().deviceInfo();
      return { model: d.model, firmware: d.firmware, online: true };
    });
  }

  // ══════════════════════════════════════════════════════════════

  private async nameOf(employeeNo: number): Promise<string> {
    const user = await this.api().searchUser(employeeNo);
    if (!user) throw new IsapiUserNotFound(employeeNo);
    return String(user.name ?? `№${employeeNo}`);
  }

  /**
   * Алдааг ангилах — outbox-ийн retry бодлогод нөлөөлнө.
   *
   * ⚠ `DigestAuthError` (нууц үг буруу) нь БАЙНГЫН алдаа. Retry хийвэл
   * терминал IP-г 30 минут түгжинэ.
   */
  private async guard<T>(fn: () => Promise<T>, retried = false): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DigestAuthError) {
        this.log.error(e.message);
        throw new PermanentError(e.message);
      }
      if (e instanceof IsapiError) {
        // 4xx = буруу өгөгдөл/эрхгүй/байхгүй → дахин оролдох утгагүй.
        if (e.status >= 400 && e.status < 500) {
          throw new PermanentError(e.message);
        }
        throw e; // 5xx — түр зуурын
      }

      // ★ ХАЯГ СОЛИГДСОН БАЙЖ МАГАДГҮЙ
      //
      // ISAPI биш, сүлжээний алдаа (fetch failed / timeout) гарсан бол
      // DHCP терминалын IP-г сольсон байх магадлалтай. Нэг л удаа
      // сканнердаж, шинэ хаягаар дахин оролдоно.
      //
      // Давтахад аюулгүй: бүх үйлдэл идемпотент («тавих», «нэмэх» биш)
      // бөгөөд сүлжээний алдаа гэдэг нь хүсэлт төхөөрөмжид ХҮРЭЭГҮЙ
      // гэсэн үг.
      if (!retried) {
        this.log.warn(
          `Терминалд хүрсэнгүй (${(e as Error).message}) — хаягийг дахин хайж байна`,
        );
        if (await this.rediscover()) {
          return this.guard(fn, true);
        }
      }
      throw e; // сүлжээ/timeout → түр зуурын, outbox retry хийнэ
    }
  }

  /** Hikvision ЛОКАЛ цагаар ажилладаг: `2026-08-24T23:59:59`. */
  private local(d: Date): string {
    const tz = this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const g = (t: string): string => p.find((x) => x.type === t)?.value ?? '00';
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`;
  }
}
