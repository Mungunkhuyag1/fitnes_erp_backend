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
  /**
   * Дараалсан амжилтгүй оролдлого.
   *
   * ⚠ Урьд нь алдааг `debug`-ээр залгидаг байв. Production дээр Nest нь
   * `debug`-ийг ХАЯДАГ тул татагч хэдэн цагаар унасан ч ЛОГТ ЮУ Ч
   * ГАРАХГҮЙ. Ирц нь түлхэлтээр орсоор байдаг учраас гаднаас бүх зүйл
   * хэвийн харагдана — зөвхөн ЗУРАГ чимээгүй дутна.
   *
   * Тиймээс: нэг-хоёр удаагийн блип чимээгүй (сүлжээ түр саатах нь
   * хэвийн), түүнээс олон бол ил анхааруулга.
   */
  private failures = 0;

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
      this.failures = 0;
    } catch (e) {
      // Терминал офлайн байх нь ХЭВИЙН (сүлжээ тасарсан, унтарсан).
      // Дараагийн давталтад дахин оролдоно.
      this.failures++;
      const msg = (e as Error).message;
      if (this.failures >= 3) {
        this.log.warn(
          `Ирц татагч ${this.failures} удаа дараалан унав: ${msg}. ` +
            'Ирц нь түлхэлтээр орсоор байгаа ч УНШУУЛАЛТЫН ЗУРАГ ' +
            'татагдахгүй байна — тунел/сүлжээг шалгана уу.',
        );
      } else {
        this.log.debug(`Ирц татах алгаслаа: ${msg}`);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Дутуу үлдсэн ирцийн ЗУРГИЙГ нөхөж татах.
   *
   * ★ ЯМАР НҮХИЙГ НӨХӨЖ БАЙНА ВЭ
   *
   * Зураг нь ХОЁР эх сурвалжаас нийлдэг: эвентийг түлхэлт (терминал →
   * үүл) авчирдаг ч зургийн хаяггүй, харин 5 минут тутамын ТАТАГЧ
   * (үүл → терминал) `picEnable`-ээр хаягийг нь авчирч нөхдөг.
   *
   * Гэвч татагч нь зөвхөн СҮҮЛИЙН 15 МИНУТЫГ хардаг. Тунел таслагдах,
   * deploy хийх, терминал түр хариугүй болох үед тэр цонх өнгөрч,
   * зураг нь ҮҮРД дутуу үлддэг байв. Түлхэлт ажилласаар байдаг тул
   * гаднаас бүх зүйл хэвийн харагдана.
   *
   * Экспортын бодит өгөгдлөөр терминал уншуулалт БҮРД зураг өгдөг
   * (411/411), тиймээс дутуу зураг гэдэг нь үргэлж ТАТАЖ АМЖААГҮЙ
   * гэсэн үг — нөхөх боломжтой.
   *
   * ⚠ Цагаар бүлэглэж татна: 50 зурагт 50 хүсэлт биш, нэг цонх нэг
   * дуудлага.
   *
   * ⚠ Хязгаартай. Терминал хуучин зургаа дарж бичсэн бол хэзээ ч
   * олдохгүй — тэр цонхнуудыг мөнхөд оролдохоос сэргийлж хайлт нь
   * `days` хоногоор хязгаарлагдана.
   */
  async backfillPictures(
    days = 3,
    maxWindows = 6,
  ): Promise<{ windows: number; fetched: number; filled: number }> {
    const before = await this.access.countMissingPictures(days);
    const hours = await this.access.hoursMissingPictures(days, maxWindows);

    let fetched = 0;
    for (const h of hours) {
      const from = new Date(h.hour);
      const to = new Date(from.getTime() + 3_600_000);
      const raw = (await this.device.fetchEvents(from, to)) as RawAcsEvent[];
      fetched += raw.length;
      for (const e of raw) {
        const m = mapAcsEvent(e);
        // Зураггүй эвентийг дамжуулах нь утгагүй — `ingest` нь
        // байгаа мөрийг зөвхөн ЗУРГААР нь шинэчилдэг.
        if (!m || m.employeeNo === null || !m.pictureUrl) continue;
        await this.access.ingest({
          employeeNo: m.employeeNo,
          eventAt: m.eventAt,
          granted: m.granted,
          verifyMode: m.verifyMode,
          reason: m.reason,
          raw: m.raw,
          pictureUrl: m.pictureUrl,
        });
      }
    }

    const filled = before - (await this.access.countMissingPictures(days));
    if (filled > 0) {
      this.log.log(
        `Ирцийн зураг нөхөв: ${filled} (${hours.length} цонх, ${fetched} эвент)`,
      );
    }
    return { windows: hours.length, fetched, filled };
  }

  /**
   * Зургийн нүхийг ӨӨРӨӨ нөхөх — цаг тутам.
   *
   * ⚠ Татагчаас ТУСДАА хуваарьтай: тэр нь 5 минут тутам ажиллах ёстой
   * (ирц шуурхай орох), энэ нь ховор бөгөөд хүнд (цонх бүр нэг хайлт).
   * Нэг давталтад нэгтгэвэл эсвэл ирц хоцрох, эсвэл терминал ачаалагдана.
   */
  @Interval('acs-picture-backfill', Number(process.env.PICTURE_BACKFILL_MS ?? 3_600_000))
  async pictureTick(): Promise<void> {
    if (this.running) return;
    if (this.config.get<string>('gateways.device') === 'stub') return;
    this.running = true;
    try {
      await this.backfillPictures();
    } catch (e) {
      this.log.debug(`Зураг нөхөх алгаслаа: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Түүхэн ирцийг буцаж татах — нэг удаагийн импорт.
   *
   * ★ ЯАГААД ТУСДАА ВЭ
   *
   * `run()` нь сүүлийн 15 минутыг л татдаг (тасалдлыг нөхөх зориулалт).
   * Терминал дээр сарын турших түүх хуримтлагдсан байхад түүнийг
   * авчрах арга байгаагүй.
   *
   * ⚠ ӨДРӨӨР ХЭСЭГЧИЛНЭ. `fetchEvents` нь 5000 мөр дээр зогсдог тул
   * 90 хоногийг нэг дуудлагаар авбал эхний хэдэн өдөр л ирээд
   * үлдсэн нь чимээгүй тасарна.
   *
   * ⚠ БИЧИХГҮЙ — зөвхөн уншина. `dedupe_key` давхардлыг зогсоох тул
   * дахин ажиллуулахад аюулгүй.
   */
  async backfill(days: number): Promise<{
    days: number;
    fetched: number;
    ingested: number;
    perDay: { day: string; fetched: number; ingested: number }[];
  }> {
    const perDay: { day: string; fetched: number; ingested: number }[] = [];
    let fetched = 0;
    let ingested = 0;

    for (let d = days - 1; d >= 0; d--) {
      const to = new Date();
      to.setHours(0, 0, 0, 0);
      to.setDate(to.getDate() - d + 1);
      const from = new Date(to);
      from.setDate(from.getDate() - 1);

      const raw = (await this.device.fetchEvents(from, to)) as RawAcsEvent[];
      let got = 0;
      for (const e of raw) {
        const m = mapAcsEvent(e);
        if (!m || m.employeeNo === null) continue;
        if (
          await this.access.ingest({
            employeeNo: m.employeeNo,
            eventAt: m.eventAt,
            granted: m.granted,
            verifyMode: m.verifyMode,
            reason: m.reason,
            raw: m.raw,
            pictureUrl: m.pictureUrl,
          })
        ) {
          got++;
        }
      }
      fetched += raw.length;
      ingested += got;
      perDay.push({
        day: from.toISOString().slice(0, 10),
        fetched: raw.length,
        ingested: got,
      });
    }

    this.log.warn(
      `Ирц буцаж татав: ${days} хоног, ${fetched} эвент, ${ingested} шинэ`,
    );
    return { days, fetched, ingested, perDay };
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
        pictureUrl: m.pictureUrl,
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
