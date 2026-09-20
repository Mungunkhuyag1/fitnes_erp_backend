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

    for (const e of events) {
      if (e.minor !== undefined && !this.knownMinor(e.minor)) continue;
      const m = mapAcsEvent(e);
      if (!m || m.employeeNo === null) continue;

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
    }

    if (ingested) this.log.log(`Терминалаас ${ingested} ирц хүлээн авав`);
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

    if (ingested === 0) {
      /*
       * ⚠ ТҮҮХИЙ БИЕИЙГ ЛОГД ШУУД БИЧНЭ.
       *
       * Урьд нь «оношлогооны дэлгэцээс хараарай» гэдэг байсан нь
       * ХУДАЛ: `webhook-traces` endpoint-д дашбордод дэлгэц холбоогүй.
       * Заалан дээр зогсож байгаа хүн токен авч, curl бичиж байж л
       * хардаг байв — түүнийг нь ч Railway дахин ассан үед санах ойгоос
       * арилгана.
       *
       * Логд байвал юу ирснийг ШУУД харна. Хоёртын хэсэгт хүрэхгүйн
       * тулд эхний 400 тэмдэгт л (текст хэсэг үргэлж эхэнд байдаг),
       * хэвлэгдэхгүй тэмдэгтийг цэгээр сольж лог эвдэхээс сэргийлнэ.
       */
      const raw = (
        Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body)
      )
        .slice(0, 400)
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '.');

      this.log.warn(
        `Түлхэлт ирсэн ч ирц бүртгэгдсэнгүй — формат=${format}, ` +
          `задалсан=${events.length}, content-type=${contentType || '—'}\n` +
          `Түүхий бие (эхний 400): ${raw}`,
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
