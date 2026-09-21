import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { Public } from '../../common/decorators/public.decorator';
import { AccessService } from './access.service';
import { classifyMinor, mapAcsEvent } from './acs-event.mapper';
import { parseWebhookPayload } from './webhook-payload';
import { WebhookInspector } from './webhook-inspector.service';

/**
 * Терминалаас ирэх ирцийн мэдэгдэл.
 *
 * ★ ЯАГААД ЭНЭ НЬ ЧУХАЛ ВЭ
 *
 * Терминал нь ЭНЭ хаяг руу ӨӨРӨӨ POST хийнэ (ISAPI `httpHosts`). Энэ бол
 * ГАДАГШ чиглэсэн холбоос тул NAT саад болохгүй — backend үүлэн дээр
 * байсан ч ирц шууд ирнэ. Agent, VPN, public IP аль нь ч шаардлагагүй.
 *
 * Эсрэг чиглэл (WinFit → терминал: хэрэглэгч бичих) нь ӨӨР асуудал —
 * тэр нь дотогш холбогдохыг шаардсаар байна.
 *
 * ⚠ Терминал дахин илгээхийг ОРОЛДДОГГҮЙ. Сүлжээ тасрах, backend дахин
 * ассах үед эвент АЛДАГДАНА. Тиймээс `AcsEventPoller` нөөц болж 5 минут
 * тутам давхцах цонхоор татна.
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/device')
export class DeviceWebhookController {
  private readonly log = new Logger(DeviceWebhookController.name);
  /** Танихгүй minor кодыг НЭГ л удаа бичнэ — лог дүүргэхгүй. */
  private readonly seenUnknown = new Set<number>();
  /** Терминалын сүүлд мэдэгдсэн IP — СОЛИГДСОН үед л сануулна. */
  private lastDeviceIp: string | null = null;

  constructor(
    private readonly access: AccessService,
    private readonly config: ConfigService,
    private readonly inspector: WebhookInspector,
  ) {}

  /**
   * Нууц үг нь ЗАМД байна.
   *
   * ЯАГААД толгойд биш вэ: терминалын `httpHosts` тохиргоо нь зөвхөн
   * URL, порт, энгийн auth хүлээж авдаг — дурын толгой нэмэх боломжгүй.
   * Тиймээс нууцыг замд шингээнэ.
   */
  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('secret') secret: string,
    @Body() body: unknown,
    @Headers('content-type') contentType = '',
    @Ip() ip?: string,
  ): Promise<{ ok: boolean; ingested: number; format: string }> {
    this.assertSecret(secret);

    const { format, events } = parseWebhookPayload(contentType, body);
    let ingested = 0;
    /** Ижил секундэд давхар ирсэн — ХЭВИЙН, доорх тайлбарыг үз. */
    let duplicate = 0;
    /**
     * Алгассан эвент бүрийн ШАЛТГААН.
     *
     * Зөвхөн тоо хэвлэвэл «1 ширхэг алгаслаа» гэдгээс цаашгүй — хаалганы
     * мэдрэгч үү, эсвэл бидний танихгүй ШИНЭ код уу гэдэг ялгарахгүй.
     * Эхнийх нь хэвийн, хоёр дахь нь ирц алдагдаж байгааг илтгэнэ.
     */
    const skipped: string[] = [];

    for (const e of events) {
      const code = `minor=${e.minor ?? '—'}/major=${e.major ?? '—'}`;
      const cls = classifyMinor(e.minor);
      if (cls.kind === 'device' || cls.kind === 'unknown') {
        // Зөвхөн ҮНЭХЭЭР танихгүй кодод сэрэмжлүүлнэ — мэдэгдэж буй
        // хаалганы мэдрэгч нь 73% тул тэдэнд сэрэмжлүүлбэл лог дүүрнэ.
        if (cls.kind === 'unknown' && e.minor !== undefined) {
          this.noteUnknown(e.minor);
        }
        skipped.push(`${code} ${cls.label}`);
        continue;
      }
      const m = mapAcsEvent(e);
      if (!m) {
        skipped.push(`${code} ирцийн эвент биш`);
        continue;
      }
      if (m.employeeNo === null) {
        /*
         * ⚠ ХОЁР ТЭС ӨӨР ТОХИОЛДОЛ — заавал ялгана.
         *
         * `denied` (76): хэн ч танигдаагүй тул дугаар БАЙХ ЁСГҮЙ. Энэ
         * бол хэвийн — таних оролдлого амжилтгүй болсон.
         *
         * `granted` (75/104/8): хүн ТАНИГДСАН, гэтэл дугаар нь тоо
         * биш. Терминал `employeeNoString`-д текст зөвшөөрдөг бол
         * WinFit-ийн `member_no` нь тоо. Энэ тохиолдолд ЖИНХЭНЭ ирц
         * алдагдаж байна — түүхий утгыг харуулж засах боломж өгнө.
         */
        if (cls.kind === 'denied') {
          skipped.push(`${code} царай танигдсангүй`);
          continue;
        }
        const who = typeof e.name === 'string' && e.name ? ` «${e.name}»` : '';
        const rawNo = e.employeeNoString ?? e.employeeNo;
        const got = rawNo === undefined || rawNo === '' ? 'хоосон' : `"${rawNo}"`;
        skipped.push(
          `${code} ⚠ ТАНИГДСАН ч дугаар нь тоо биш (employeeNo=${got})${who} — ирц алдагдаж байна`,
        );
        continue;
      }

      // ⚠ `serialNo`-г ЗОРИУДААР дамжуулахгүй.
      //
      // Терминал нэг ирэлт дээр minor 75 БА 104-ийг ижил секундэд хоёуланг
      // илгээдэг (бодит өгөгдлөөр батлагдсан). `serialNo` дамжуулбал тэд
      // хоёр өөр мөр болно. Дамжуулахгүй бол давхардлын түлхүүр нь
      // (төхөөрөмж + хүн + секунд) болж хоёуланг НЭГ ирц болгоно.
      const ok = await this.access.ingest({
        employeeNo: m.employeeNo,
        eventAt: m.eventAt,
        granted: m.granted,
        verifyMode: m.verifyMode,
        raw: m.raw,
        pictureUrl: m.pictureUrl,
      });
      if (ok) ingested++;
      else duplicate++;
    }

    /*
     * ★ ТЕРМИНАЛЫН ӨӨРИЙН IP-Г ХЭВЛЭНЭ.
     *
     * DHCP хаяг солиход туннелийн чиглэл эзэнгүй болж `502` өгдөг ч
     * түлхэлт нь ГАДАГШ явдаг тул ирсээр байна. Өөрөөр хэлбэл ирц
     * ажиллаж байхад л хаягийг мэдэж болно — заалан дээр очих
     * шаардлагагүй. `docs/12` §7.1-д «үүнийг анхааруулдаг систем
     * БАЙХГҮЙ» гэсэн цоорхойг нөхнө.
     *
     * Хаяг СОЛИГДСОН үед л бичнэ — эс бөгөөс мөр бүрд давтагдана.
     */
    // ⚠ `ip` нь ХҮСЭЛТИЙН эх хаяг (`@Ip()`) — өөр зүйл. Терминалын
    //   өөрийн хаягийг ялгаж нэрлэнэ.
    const deviceIp = events.find(
      (e) => typeof e.deviceIp === 'string',
    )?.deviceIp;
    if (typeof deviceIp === 'string' && deviceIp !== this.lastDeviceIp) {
      const before = this.lastDeviceIp;
      this.lastDeviceIp = deviceIp;
      this.log.warn(
        before
          ? `⚠ Терминалын IP СОЛИГДЛОО: ${before} → ${deviceIp}. ` +
              'Cloudflare → winfit-hik → route → Service URL-ыг шинэчилнэ үү.'
          : `Терминалын IP: ${deviceIp}`,
      );
    }

    if (ingested) {
      this.log.log(`Терминалаас ${ingested} ирц хүлээн авав`);
    } else if (duplicate) {
      // Хос эвентийн хоёр дахь нь — хүлээгдэж буй зүйл, LOG биш DEBUG.
      this.log.debug(`Давхардсан түлхэлт алгаслаа (${duplicate})`);
    } else if (skipped.length) {
      this.log.debug(`Ирцэд хамааралгүй эвент — ${skipped.join(' · ')}`);
    }
    /*
     * ⚠ ЧИМЭЭГҮЙ БҮТЭЛГҮЙТЭЛ — энэ төслийн хамгийн хортой алдаа.
     *
     * Терминал 200 авмагц «болсон» гэж үзнэ. Бид биеийг задалж
     * чадаагүй ч 200 буцаадаг байсан тул ирц ирэхгүй мөртлөө хаана ч
     * алдаа харагдахгүй. Одоо юу ирснийг санаж, сануулга бичнэ.
     */
    this.inspector.record({
      ip: ip ?? null,
      contentType,
      bytes: Buffer.isBuffer(body) ? body.length : JSON.stringify(body ?? '').length,
      format,
      parsed: events.length,
      ingested,
      raw: Buffer.isBuffer(body)
        ? body.toString('utf8')
        : JSON.stringify(body ?? null),
    });

    /*
     * ⚠ ЗӨВХӨН ҮНЭХЭЭР ОЙЛГООГҮЙ үед сануулна.
     *
     * Урьд нь `ingested === 0` бүрд сануулдаг байсан нь ХЭВИЙН
     * ажиллагааг алдаа мэт харуулж байв:
     *
     *   · Терминал нэг ирэлт дээр minor 75 БА 104-ийг ИЖИЛ секундэд
     *     илгээдэг. Хоёр дахийг нь `dedupeKey` зориудаар хаяна — нэг
     *     хүн нэг ирц болгохын тулд. Энэ бол ЗӨВ үр дүн.
     *   · Хаалганы мэдрэгч, эвдрэлийн дохио зэрэг төхөөрөмжийн эвент нь
     *     нийтийн 77% (docs/03). Тэдгээр нь ирц БИШ.
     *
     * Ийм мөрүүд логийг улаанаар дүүргэвэл ЖИНХЭНЭ асуудал живнэ.
     * Одоо зөвхөн биеийг огт задалж чадаагүй үед л сануулна.
     */
    if (events.length === 0) {
      /*
       * ⚠ ТҮҮХИЙ БИЕИЙГ ЛОГД ШУУД БИЧНЭ.
       *
       * Урьд нь «оношлогооны дэлгэцээс хараарай» гэдэг байсан нь
       * ХУДАЛ: `webhook-traces` endpoint-д дашбордод дэлгэц холбоогүй.
       * Заалан дээр зогсож байгаа хүн токен авч, curl бичиж байж л
       * хардаг байв — түүнийг нь ч Railway дахин ассан үед санах ойгоос
       * арилгана.
       *
       * Логд байвал юу ирснийг ШУУД харна.
       *
       * ⚠ ЗААВАЛ НЭГ МӨР БОЛГОНО. Түүхий бие нь олон мөрт бөгөөд хэд
       * хэдэн түлхэлт зэрэг ирдэг тул мөр таслалттайгаар бичвэл логууд
       * хооронд нь орооцолдож, аль мөр алинд нь хамаарахыг ялгах
       * боломжгүй болно. Мөр таслалтыг `⏎` болгож, хэвлэгдэхгүй
       * тэмдэгтийг цэгээр солино.
       */
      const raw = (
        Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body)
      )
        .slice(0, 300)
        .replace(/\r?\n/g, '⏎')
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '.')
        .replace(/\s{2,}/g, ' ');

      this.log.warn(
        `Түлхэлтийн биеийг задалж чадсангүй — формат=${format}, ` +
          `content-type=${contentType || '—'} · бие: ${raw}`,
      );
    }

    return { ok: true, ingested, format };
  }

  private assertSecret(given: string): void {
    const want = this.config.get<string>('device.webhookSecret');
    if (!want) {
      throw new UnauthorizedException('DEVICE_WEBHOOK_SECRET тохируулаагүй');
    }
    const a = Buffer.from(given ?? '');
    const b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Нууц буруу');
    }
  }

  /**
   * Терминал эвентээ хэд хэдэн хэлбэрээр илгээдэг тул бүгдийг барина:
   *   · `{ AccessControllerEvent: {...} }`   — ISAPI-ийн стандарт боодол
   *   · `{ ... }`                            — шууд эвент
   *   · `[ {...}, {...} ]`                   — багц
   */
  /**
   * Үл мэдэгдэх кодыг НЭГ л удаа сануулна.
   *
   * ⚠ Зөвхөн `classifyMinor` нь `unknown` гэсэн кодод дуудагдана.
   * Хаалганы мэдрэгч (21–24) зэрэг БАТЛАГДСАН кодод дуудвал лог
   * сэрэмжлүүлгээр дүүрч, жинхэнэ шинэ код живнэ.
   */
  private noteUnknown(minor: number): void {
    if (this.seenUnknown.has(minor)) return;
    this.seenUnknown.add(minor);
    // Таамаглаж «зөвшөөрөв» гэж бүртгэхгүй — харин мэдэгдэнэ.
    this.log.warn(
      `Танихгүй эвентийн код minor=${minor} — алгаслаа. ` +
        'Ирц мөн эсэхийг docs/03 §6.1-тэй тулгана уу.',
    );
  }
}
