import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
import { mapAcsEvent, type RawAcsEvent } from './acs-event.mapper';

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
  ): Promise<{ ok: boolean; ingested: number }> {
    this.assertSecret(secret);

    const events = this.extract(body);
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
      });
      if (ok) ingested++;
    }

    if (ingested) this.log.log(`Терминалаас ${ingested} ирц хүлээн авав`);
    return { ok: true, ingested };
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
  private extract(body: unknown): RawAcsEvent[] {
    if (Array.isArray(body)) return body as RawAcsEvent[];
    if (!body || typeof body !== 'object') return [];
    const o = body as Record<string, unknown>;
    const inner =
      (o.AccessControllerEvent as Record<string, unknown> | undefined) ??
      (o.AcsEvent as Record<string, unknown> | undefined) ??
      o;
    return [inner as RawAcsEvent];
  }

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
