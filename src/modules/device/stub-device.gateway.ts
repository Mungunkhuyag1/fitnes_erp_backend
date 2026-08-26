import { Injectable, Logger } from '@nestjs/common';
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
export class StubDeviceGateway implements DeviceGateway {
  private readonly log = new Logger(StubDeviceGateway.name);
  private readonly users = new Map<number, StubUser>();

  constructor(private readonly config: ConfigService) {}

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

  async info(): Promise<DeviceInfo> {
    const offline = this.config.get<boolean>('stub.deviceOffline') ?? false;
    return {
      model: 'DS-K1T320MFX (stub)',
      firmware: 'V0.0.0-stub',
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
