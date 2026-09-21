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
import { mapAcsEvent } from './acs-event.mapper';
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
      if (e.minor !== undefined && !this.knownMinor(e.minor)) {
        skipped.push(`${code} танихгүй код`);
        continue;
      }
      const m = mapAcsEvent(e);
      if (!m) {
        skipped.push(`${code} ирцийн эвент биш`);
        continue;
      }
      if (m.employeeNo === null) {
        /*
         * Ирцийн код мөн боловч ХҮНИЙ ДУГААР дагалдаагүй — ихэвчлэн
         * minor 76 (царай танигдсангүй). Хэн болох нь тодорхойгүй тул
         * мөр үүсгэж чадахгүй. Терминалын өгсөн нэрийг хэвлэвэл
         * ядаж ямар тохиолдол болохыг таамаглахад тустай.
         */
        const who = typeof e.name === 'string' && e.name ? ` «${e.name}»` : '';
        skipped.push(`${code} хүний дугааргүй${who}`);
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
  private knownMinor(minor: number): boolean {
    const known = [75, 104, 8, 76].includes(minor);
    if (!known && !this.seenUnknown.has(minor)) {
      this.seenUnknown.add(minor);
      // Шинэ firmware өөр код илгээж болно. Таамаглаж «зөвшөөрөв» гэж
      // бүртгэхгүй — харин мэдэгдэнэ.
      this.log.warn(`Танихгүй эвентийн код minor=${minor} — алгаслаа`);
    }
    return known;
  }
}
