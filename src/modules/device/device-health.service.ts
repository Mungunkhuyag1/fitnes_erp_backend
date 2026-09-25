import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailEvent } from '../mail/mail.entity';
import { MailService } from '../mail/mail.service';
import { Device } from './device.entity';
import { DEVICE_GATEWAY, type DeviceGateway } from './device.gateway';
import { IsapiError } from './isapi/isapi.client';
import {
  QUIET_FROM_HOUR,
  QUIET_TO_HOUR,
  inQuietHours,
} from '../../config/schedule';

/** Дараалсан хэдэн алдааны дараа «унтарсан» гэж үзэх вэ. */
const FAIL_THRESHOLD = 3;

/** Сэргэсэн гэж үзэхэд хэдэн амжилт хэрэгтэй вэ. */
const RECOVER_THRESHOLD = 2;

/**
 * Хоёр мэйлийн ХАМГИЙН БАГА зай.
 *
 * ⚠ ЯАГААД ЗААВАЛ ХЭРЭГТЭЙ ВЭ
 *
 * «Зөвхөн шилжилтэд мэйлдэнэ» гэдэг нь холболт тогтвортой үед л
 * хангалттай. Чичирвэл (унтарч асаад байвал) шилжилт бүр мэйл
 * болно: 3 алдаа (15 мин) → мэйл, 1 амжилт → мэйл. 20 минутын
 * мөчлөгөөр өдөрт ~144 мэйл, хоёр хаягт 288 — Resend-ийн өдрийн
 * хязгаар дүүрч, ЖИНХЭНЭ сануулга дараа нь хүрэхгүй болно.
 *
 * Тиймээс мэйлийг цагт нэгээр хязгаарлана. Санд бүртгэх нь
 * хязгааргүй — дашборд үргэлж яг одоогийн байдлыг харуулна.
 */
const NOTIFY_COOLDOWN_MS = 60 * 60_000;

/**
 * Терминал амьд эсэхийг хянаж, унтарвал мэйлдэнэ.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ БОЛСОН БЭ
 *
 * `online` ба `lastSeenAt` хоёр байсан ч ердийн ажиллагаанд ХЭЗЭЭ Ч
 * шинэчлэгддэггүй байв — зөвхөн `remember()` дотор, тэр нь гараар
 * оношлогоо/хаяг хайх үед л дуудагддаг. Үр дүнд нь прод дээр
 * `online=true`, `lastSeenAt=2026-08-26` гэж хөлдөж, терминал
 * унасныг хэн ч мэдэхгүй байв.
 *
 * ★ ЯАГААД ТУСДАА ИНТЕРВАЛ ВЭ
 *
 * Ирцийн сондгойлогч мөн 5 минут тутам терминалтай ярьдаг тул түүнд
 * холбож болох байсан. Гэхдээ тэр нь `access` модульд байгаа ба
 * ирцийн логиктой ороосон. `deviceInfo` нь НЭГ хөнгөн дуудлага
 * (`listUsers` бол 12 хуудас) тул тусдаа цохилт нь терминалд бараг
 * ачаалал өгөхгүй, харин эзэмшил тодорхой болно.
 *
 * ★ ЯАГААД ЗӨВХӨН ШИЛЖИЛТЭД МЭЙЛДЭХ ВЭ
 *
 * Унтарсан хэвээр байгаа терминалын тухай 5 минут тутам мэйл явуулбал
 * хоёр дахь өдрөөс хэн ч уншихаа болино. Зөвхөн ХӨДӨЛГӨӨН дээр:
 * ажиллаж байснаа унтарсан, эсвэл унтарснаа сэргэсэн.
 */
@Injectable()
export class DeviceHealthService {
  private readonly log = new Logger(DeviceHealthService.name);

  /**
   * Дараалсан алдааны тоо — САНАХ ОЙД.
   *
   * ⚠ Railway дахин ассан үед тэглэгдэнэ. Хамгийн муудаа сануулга
   * 15 минут хоцорно — санд бичиж хадгалах үнэ цэнэ нь тэр эрсдэлээс
   * бага.
   */
  private fails = 0;

  /** Дараалсан амжилт — сэргэлтийг батлахад. */
  private oks = 0;

  /**
   * Хамгийн сүүлд МЭЙЛЭЭР хэлсэн төлөв, ба хэзээ хэлснийг.
   *
   * `online` талбартай ижил биш: сан нь чичиргээ бүрийг тэмдэглэнэ,
   * энэ хоёр нь зөвхөн мэйл явуулсныг санана.
   */
  private toldOnline: boolean | null = null;
  private toldAt = 0;

  /**
   * Шөнийн ХҮЛЭЭГДСЭН унтралтыг мэйлгүй алгассан уу.
   *
   * ⚠ Санах ойд — Railway дахин ассан үед тэглэгдэнэ. Хамгийн муудаа
   * шөнө нэг «терминал холбогдохгүй» мэйл гарна, эсвэл өглөө нэг
   * «сэргэлээ» мэйл дутна. Хоёр нь ч аюултай биш.
   */
  private quietDown = false;

  constructor(
    @Inject(DEVICE_GATEWAY) private readonly device: DeviceGateway,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Ирцийн сондгойлогчтой ижил хэмнэл. */
  @Interval('device-health', Number(process.env.DEVICE_HEALTH_MS ?? 300_000))
  async tick(): Promise<void> {
    // ⚠ `stub` ГОРИМД Ч АЖИЛЛАНА — зориуд.
    //
    // Эхлээд «локал дээр мэйл цацахгүйн тулд» stub-ыг алгасаж байв.
    // Тэр нь буруу давхаргад тавьсан хамгаалалт байлаа:
    // `STUB_DEVICE_OFFLINE` түлхүүр нь ЯГ энэ анхааруулгыг шалгахад
    // зориулагдсан (stub-device.gateway.ts) — алгасвал тэр хэрэгсэл
    // чимээгүй ажиллахаа больдог.
    //
    // Санамсаргүй мэйлээс `MailProvider` өөрөө хамгаална:
    // `MAIL_MODE` нь `live` биш бол жинхэнэ хаяг руу юу ч явахгүй,
    // зөвхөн логт бичигдэнэ. Хамгаалалт нэг газар байх нь хангалттай.
    try {
      const info = await this.device.info();
      // ⚠ Шидэхгүйгээр «унтарсан» гэж хэлж болно. `DeviceInfo.online`
      // нь интерфейсийн нэг хэсэг — stub нь яг үүгээр офлайныг
      // дуурайлгадаг. Зөвхөн exception хүлээвэл тэр дохиог алдана.
      if (info.online === false) {
        await this.down(new Error('Терминал өөрөө «офлайн» гэж мэдээллээ'));
        return;
      }
      await this.up(info);
    } catch (e) {
      await this.down(e);
    }
  }

  /** Амжилттай — цохилт бичиж, унтарсан байсан бол сэргэлтийг мэдэгдэнэ. */
  private async up(info: { model?: string; firmware?: string }): Promise<void> {
    this.fails = 0;
    this.oks++;
    const row = await this.row();
    if (!row) return;

    const wasDown = !row.online;
    // ⚠ Нэг амжилтаар сэргэсэн гэж үзвэл чичиргээ бүр мэйл болно.
    if (wasDown && this.oks < RECOVER_THRESHOLD) {
      this.log.debug(`Терминал хариулж эхлэв (${this.oks}/${RECOVER_THRESHOLD})`);
      return;
    }
    const downSince = row.lastErrorAt;
    const reason = row.lastError;

    row.online = true;
    row.lastSeenAt = new Date();
    row.lastError = null;
    row.lastErrorAt = null;
    // Терминал солигдсон/шинэчлэгдсэн бол энд өөрөө мэдэгдэнэ.
    if (info.model) row.model = info.model;
    if (info.firmware) row.firmware = info.firmware;
    await this.devices.save(row);

    if (!wasDown) return;

    // Шөнийн унтралтыг мэйлдээгүй бол сэргэлтийг ч мэйлдэхгүй — эс
    // бөгөөс өдөр бүр «сэргэлээ» гэсэн НЭГ ТАЛТ мэйл явна.
    if (this.quietDown) {
      this.quietDown = false;
      this.log.log('Терминал сэргэв — шөнийн хүлээгдсэн унтралт тул мэйлдсэнгүй');
      return;
    }

    if (!this.mayNotify(true)) {
      this.log.log('Терминал сэргэв — мэйл завсарлагад таарсан тул алгаслаа');
      return;
    }

    const mins = downSince
      ? Math.round((Date.now() - downSince.getTime()) / 60_000)
      : null;
    this.log.log(`Терминал сэргэв${mins !== null ? ` (${mins} мин унтарсан)` : ''}`);
    await this.mail.notify(
      MailEvent.SYNC_FAILED,
      '✓ WinFit — терминал сэргэлээ',
      this.html([
        ['Төлөв', 'Холболт сэргэсэн'],
        ['Хэзээ', this.when(new Date())],
        ...(mins !== null ? [['Хэр удаан унтарсан', `${mins} минут`] as const] : []),
        ...(reason ? [['Байсан шалтгаан', reason] as const] : []),
      ]),
    );
  }

  /** Алдаа — босго давсан үед НЭГ УДАА мэдэгдэнэ. */
  private async down(e: unknown): Promise<void> {
    this.fails++;
    this.oks = 0;
    const { reason, fix } = classify(e);

    if (this.fails < FAIL_THRESHOLD) {
      this.log.debug(`Терминал хариугүй (${this.fails}/${FAIL_THRESHOLD}): ${reason}`);
      return;
    }

    const row = await this.row();
    if (!row) return;

    const quiet = inQuietHours();

    // ⚠ «Аль хэдийн мэдэгдсэн»-ийг `online` БИШ, `lastErrorAt`-аар
    // тэмдэглэнэ.
    //
    // Эхлээд `!row.online` гэж үзэж байсан нь алдаа байв: `online`-г
    // `remember()` ба migration ч бичдэг. 1788120000000 нь хуучин
    // мөрийг `online=false` болгосон тул шалгагч эхний удаад
    // «аль хэдийн мэдэгдсэн» гэж буруу дүгнэж, ХАМГИЙН ЭХНИЙ
    // сануулгыг дуугүй алгассан.
    //
    // `lastErrorAt`-ыг ЗӨВХӨН энэ үйлчилгээ бичдэг тул андуурахгүй.
    let alreadyNotified = row.lastErrorAt !== null;

    /*
     * ⚠ ЗААЛ НЭЭГДСЭН Ч ХЭВЭЭР УНТАРСАН — ЭНЭ Л ЖИНХЭНЭ САНУУЛГА
     *
     * Шөнө мэйлийг алгасахдаа `lastErrorAt`-ыг тавьсан байна. Түүнийг
     * «аль хэдийн мэдэгдсэн» гэж уншвал өглөөний сануулга ХЭЗЭЭ Ч
     * явахгүй болно — заалны компьютер асаагүй өдөр яг тэр нь хэрэгтэй.
     * Тиймээс завсарлага дуусмагц шилжилтийг ШИНЭЭР тоолно.
     */
    if (!quiet && this.quietDown) {
      this.quietDown = false;
      this.toldOnline = null;
      alreadyNotified = false;
    }

    row.online = false;
    row.lastError = reason;
    if (!alreadyNotified) row.lastErrorAt = new Date();
    await this.devices.save(row);

    /*
     * ★ ШӨНИЙН ХҮЛЭЭГДСЭН УНТРАЛТЫГ МЭЙЛДЭХГҮЙ
     *
     * Терминал руу зөвхөн заалны Windows PC дээрх `cloudflared`-аар
     * хүрнэ. Заал хаагдахад тэр PC унтардаг тул холболт тасрах нь
     * АЛДАА БИШ, хуваарь. Завсарлагагүй бол ~22:15-д «терминал
     * холбогдохгүй байна», ~07:05-д «сэргэлээ» гэсэн хос мэйл ӨДӨР
     * БҮР явж, хоёр хаягт сард ~60 мэйл болно — хүн уншихаа болино,
     * тэгээд ЖИНХЭНЭ асуудал нүднээс алдагдана.
     *
     * ⚠ САНД БИЧСЭН ХЭВЭЭР (дээр). Дашборд «унтарсан» гэдгийг
     * үргэлж зөв харуулна — зөвхөн МЭЙЛ хаагдана.
     */
    if (quiet) {
      /*
       * ⚠ ЗӨВХӨН ШӨНӨ ШИНЭЭР унтарсныг «шөнийн унтралт» гэж тоолно.
       *
       * Нөхцөлгүй тавьбал: терминал 21:00-д (ӨДӨР) унтарч, 21:15-д
       * «унтарлаа» мэйл яваад, 22:05-ийн цохилт нь завсарлагад орж
       * `quietDown = true` болно. Өглөө сэргэхэд `up()` нь түүнийг
       * «шөнийн хэвийн унтралт» гэж уншиж СЭРГЭЛТИЙН мэйлийг
       * алгасна — админ «унтарлаа» гэж авчихаад «сэргэлээ» гэж
       * ХЭЗЭЭ Ч авахгүй. Тэр нь хамгийн их хүлээж байдаг мэйл.
       */
      if (!alreadyNotified) this.quietDown = true;
      this.log.log(
        `Терминал холбогдохгүй (${reason}) — заал хаалттай цаг ` +
          `(${QUIET_FROM_HOUR}:00–${QUIET_TO_HOUR}:00) тул мэйлдсэнгүй`,
      );
      return;
    }

    // ⚠ Унтарсан хэвээр бол дахин мэйлдэхгүй. Зөвхөн шилжилтэд.
    if (alreadyNotified) return;
    if (!this.mayNotify(false)) {
      this.log.warn(`Терминал унтарлаа (${reason}) — мэйл завсарлагад таарсан тул алгаслаа`);
      return;
    }

    this.log.warn(`Терминал холбогдохгүй байна: ${reason}`);
    await this.mail.notify(
      MailEvent.SYNC_FAILED,
      '⚠ WinFit — терминал холбогдохгүй байна',
      this.html([
        ['Шалтгаан', reason],
        ['Хийх зүйл', fix],
        ['Хэзээ', this.when(new Date())],
        ['Шалгасан', `${FAIL_THRESHOLD} удаа дараалан`],
      ]) +
        '<p style="color:#666;font-size:13px">Гишүүд хаалганаас ҮРГЭЛЖЛҮҮЛЭН ' +
        'орно, ирц ч цугларсаар байна — терминал өөрөө шийддэг. Зогсох нь ' +
        'зөвхөн дашбордоос терминал руу хандах үйлдэл.</p>',
    );
  }

  /**
   * Энэ төлөвийг мэйлдэж болох уу.
   *
   * ★ ЗАВСАРЛАГА ТЭГШ БУС — зориуд
   *
   * Эхлээд хоёр чиглэлд адил завсарлага тавьсан нь буруу байв:
   * 10:00-д «унтарлаа» мэйл яваад, 10:30-д заалан дээр cloudflared
   * суулгавал «сэргэлээ» гэсэн БАТАЛГАА нь завсарлагад баригдана.
   * Хэрэглэгчийн хамгийн их хүлээж буй мэйл яг тэр.
   *
   * Тиймээс:
   *   сэргэлт — унтарснаа хэлсэн бол ҮРГЭЛЖ явна
   *   унтралт — цагт нэгээр хязгаарлана
   *
   * Чичиргээний хамгаалалт хэвээр: сэргэлтийн мэйл гарахын тулд
   * өмнө нь унтралт мэдэгдсэн байх ёстой, тэр нь цагт нэгээр
   * хязгаарлагдсан. Өөрөөр хэлбэл хос нь цагт нэгээс хэтрэхгүй.
   */
  private mayNotify(online: boolean): boolean {
    if (this.toldOnline === online) return false;
    // Унтралтад л завсарлага үйлчилнэ.
    if (!online && Date.now() - this.toldAt < NOTIFY_COOLDOWN_MS) return false;
    this.toldOnline = online;
    this.toldAt = Date.now();
    return true;
  }

  private row(): Promise<Device | null> {
    return this.devices.findOne({
      where: { active: true },
      order: { createdAt: 'ASC' },
    });
  }

  private when(d: Date): string {
    return d.toLocaleString('mn-MN', {
      timeZone: this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar',
    });
  }

  private html(rows: readonly (readonly [string, string])[]): string {
    const tr = rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#666">${k}</td>` +
          `<td style="padding:6px 0"><b>${v}</b></td></tr>`,
      )
      .join('');
    return `<table style="border-collapse:collapse;font:14px system-ui">${tr}</table>`;
  }
}

/**
 * Алдааг ХҮН УНШИХ шалтгаан болгох.
 *
 * ⚠ Энэ бол энэ ажлын гол утга учир. «Терминал холбогдохгүй байна»
 * гэдэг мэдээлэл биш — 530 бол заалны компьютер унтарсан, 502 бол
 * терминалын IP солигдсон, 403 бол Access токен буруу. Гурав нь
 * ГУРВАН ӨӨР газар засагдана.
 */
export function classify(e: unknown): { reason: string; fix: string } {
  if (e instanceof IsapiError) {
    switch (e.status) {
      case 530:
        return {
          reason: '530 — Cloudflare туннельд холбогч алга',
          fix: 'Заалны компьютер унтарсан, эсвэл cloudflared зогссон. PC-г асаа. PowerShell: Get-Service cloudflared',
        };
      case 502:
        return {
          reason: '502 — терминалын IP солигдсон бололтой',
          fix: 'Холбогч ажиллаж байгаа ч 192.168.0.106 дээр хэн ч хариулахгүй. Cloudflare → Tunnels & Mesh → winfit-hik → Published application routes → URL. docs/12 §7.1',
        };
      case 403:
        return {
          reason: '403 — Cloudflare Access татгалзав',
          fix: 'HIK_ACCESS_CLIENT_ID / _SECRET буруу эсвэл дутуу. Railway → Variables. Хоёуланг нь шалга',
        };
      case 401:
        return {
          reason: '401 — терминалын нэвтрэх нэр/нууц үг буруу',
          fix: 'HIK_USER / HIK_PASSWORD-ыг шалга. Терминал дээр нууц үг солигдсон эсэх',
        };
      default:
        return {
          reason: `ISAPI ${e.status}`,
          fix: 'docs/12 §7 дэх кодын хүснэгтийг үз',
        };
    }
  }

  const msg = e instanceof Error ? e.message : String(e);
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg))
    return {
      reason: 'Хаяг олдсонгүй (DNS)',
      fix: 'HIK_HOST зөв эсэхийг шалга — hik.winfit.mn байх ёстой',
    };
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|abort/i.test(msg))
    return {
      reason: `Сүлжээ хариугүй — ${msg.slice(0, 80)}`,
      fix: 'Заалны интернэт эсвэл Cloudflare туннелийг шалга',
    };
  return { reason: msg.slice(0, 160), fix: 'docs/12 §7-г үз' };
}
