import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermanentError } from '../outbox/outbox.errors';
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
  type UpsertUserInput,
} from './device.gateway';

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

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.config.get<string>('gateways.device') !== 'direct') return;
    const host = this.config.get<string>('hikvision.host');
    if (!host) {
      this.log.error(
        'DEVICE_GATEWAY=direct боловч HIK_HOST тохируулаагүй байна',
      );
      return;
    }
    this.client = new IsapiClient({
      host,
      port: this.config.get<number>('hikvision.port'),
      user: this.config.getOrThrow<string>('hikvision.user'),
      password: this.config.getOrThrow<string>('hikvision.password'),
      https: this.config.get<boolean>('hikvision.https'),
      timeoutMs: 15_000,
    });
    this.log.log(`Терминалтай шууд холбогдоно: ${this.client.address}`);
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

  async openDoor(doorNo?: number): Promise<void> {
    await this.guard(() => this.api().openDoor(doorNo ?? this.doorNo));
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
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
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
      }
      throw e; // сүлжээ/timeout/5xx → түр зуурын, retry хийнэ
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
