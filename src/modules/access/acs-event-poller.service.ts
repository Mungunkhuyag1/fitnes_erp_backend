import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DEVICE_GATEWAY, type DeviceGateway } from '../device/device.gateway';
import { AccessService } from './access.service';
import { mapAcsEvent, type RawAcsEvent } from './acs-event.mapper';

/**
 * Ирцийн НӨӨЦ суваг — терминалаас давхцах цонхоор татна.
 *
 * ★ ЯАГААД ХОЁР СУВАГ ХЭРЭГТЭЙ ВЭ
 *
 * Гол суваг нь терминалын түлхэлт (`POST /webhooks/device/:secret`) —
 * саатал 1 секундээс бага. Гэвч терминал дахин илгээхийг ОРОЛДДОГГҮЙ:
 * сүлжээ тасрах, backend дахин ассах, deploy хийх үед тэр хугацааны
 * эвент бүрмөсөн алдагдана.
 *
 * Энэ ажил 5 минут тутам СҮҮЛИЙН 15 МИНУТЫГ дахин татна. Давхцах цонх
 * нь алдагдсаныг нөхнө. Давхардлыг `dedupe_key` зогсооно.
 *
 * ⚠ Стандарт `dedupe_key` нь (төхөөрөмж + хүн + секунд) дээр тулгуурладаг
 * тул түлхэлтээр ирсэн эвент дахин орохгүй.
 */
@Injectable()
export class AcsEventPoller {
  private readonly log = new Logger(AcsEventPoller.name);
  private running = false;

  constructor(
    @Inject(DEVICE_GATEWAY) private readonly device: DeviceGateway,
    private readonly access: AccessService,
    private readonly config: ConfigService,
  ) {}

  @Interval(
    'acs-event-poll',
    Number(process.env.DEVICE_EVENT_POLL_MS ?? 300_000),
  )
  async tick(): Promise<void> {
    // Өмнөх татан авалт дуусаагүй бол алгасна — терминал удаан хариулж
    // байхад хүсэлт овоорвол төхөөрөмж боогдоно.
    if (this.running) return;
    // Stub горимд татах зүйл байхгүй — терминал руу дэмий очихгүй.
    if (this.config.get<string>('gateways.device') === 'stub') return;

    this.running = true;
    try {
      await this.run();
    } catch (e) {
      // Терминал офлайн байх нь ХЭВИЙН (сүлжээ тасарсан, унтарсан).
      // Дараагийн давталтад дахин оролдоно.
      this.log.debug(`Ирц татах алгаслаа: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Гараар ажиллуулах (`/sync` дэлгэц). */
  async run(): Promise<{ fetched: number; ingested: number }> {
    const windowMin =
      this.config.get<number>('device.pollWindowMin') ?? 15;
    const to = new Date();
    const from = new Date(to.getTime() - windowMin * 60_000);

    const raw = (await this.device.fetchEvents(from, to)) as RawAcsEvent[];
    let ingested = 0;

    for (const e of raw) {
      const m = mapAcsEvent(e);
      if (!m || m.employeeNo === null) continue;
      // `serialNo` дамжуулахгүй — §webhook-той ижил шалтгаан: терминал
      // нэг ирэлт дээр minor 75 ба 104-ийг ижил секундэд илгээдэг.
      const ok = await this.access.ingest({
        employeeNo: m.employeeNo,
        eventAt: m.eventAt,
        granted: m.granted,
        verifyMode: m.verifyMode,
        raw: m.raw,
      });
      if (ok) ingested++;
    }

    if (ingested) {
      this.log.log(
        `Ирц нөхөв: ${raw.length} эвентээс ${ingested} шинэ (${windowMin} мин цонх)`,
      );
    }
    return { fetched: raw.length, ingested };
  }
}
