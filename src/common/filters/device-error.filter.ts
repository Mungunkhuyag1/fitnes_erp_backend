import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { DeviceUnreachableError } from '../../modules/device/device.gateway';
import { DigestAuthError } from '../../modules/device/isapi/digest';
import { IsapiError } from '../../modules/device/isapi/isapi.client';

/**
 * Терминалын алдааг ХҮНИЙ ХЭЛЭЭР буцаана.
 *
 * ★ ЯМАР АСУУДЛЫГ ШИЙДЭЖ БАЙНА ВЭ
 *
 * Терминал Cloudflare тунелээр дамждаг. Тунел унавал Cloudflare
 * ӨӨРИЙН алдааны ХУУДСЫГ буцаадаг — 530 статус, 6 КБ HTML. Урьд нь
 * тэр бүхэл HTML нь алдааны мессеж болж:
 *
 *     ERROR IsapiError: ISAPI 530: <!doctype html> ...
 *     → дэлгэц дээр «Internal server error»
 *
 * Ажилтан юу болсныг огт мэдэхгүй: терминал эвдэрсэн үү, интернет
 * тасарсан уу, эсвэл WinFit-д алдаа гарсан уу. Гурвуулангийнх нь
 * засвар өөр.
 *
 * ★ ЯАГААД ШҮҮЛТҮҮР ВЭ (контроллер бүрт биш)
 *
 * Терминал руу хандах гарц олон: синк, тулгалт, оношилгоо, хаалга
 * нээх, царай уншуулах, зураг татах. Тус бүрд `try/catch` бичвэл
 * нэгийг нь мартах нь цаг хугацааны асуудал бөгөөд шинээр нэмэгдсэн
 * нь үргэлж хамгаалалтгүй үлдэнэ. Шүүлтүүр нь БҮГДИЙН доогуур
 * өнгөрдөг ганц цэг.
 *
 * ★ ГУРВАН АНГИЛАЛ, ГУРВАН ӨӨР ЗАСВАР
 *
 *  · `DeviceUnreachableError` → холболт салсан   → заалны компьютер
 *  · `DigestAuthError`        → нэвтрэлт буруу   → нууц үг
 *  · `IsapiError`             → терминал татгалзав → тухайн үйлдэл
 */
@Catch(DeviceUnreachableError, DigestAuthError, IsapiError)
export class DeviceErrorFilter implements ExceptionFilter {
  private readonly log = new Logger(DeviceErrorFilter.name);

  catch(
    err: DeviceUnreachableError | DigestAuthError | IsapiError,
    host: ArgumentsHost,
  ): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.describe(err);

    /*
     * ⚠ Логт ТҮҮХИЙ биеийг бичихгүй — Cloudflare-ийн хуудас 6 КБ.
     * Railway-гийн лог дүүрч, жинхэнэ мөрүүд алга болно.
     */
    this.log.warn(`${err.name}: ${body.message}`);
    res.status(status).json({ ...body, statusCode: status });
  }

  private describe(err: Error): {
    status: number;
    body: { message: string; error: string; hint?: string };
  } {
    if (err instanceof DeviceUnreachableError) {
      return {
        // 503 — «түр зуур боломжгүй». Дуудагч тал дахин оролдож болно.
        status: HttpStatus.SERVICE_UNAVAILABLE,
        body: {
          message: `Терминалтай холболт салсан байна — ${err.reason}.`,
          error: 'DeviceUnreachable',
          hint:
            'Заалан дээрх компьютер асаалттай, интернетэд холбогдсон ' +
            'эсэхийг шалгана уу. Гишүүд хаалгаар ҮРГЭЛЖЛҮҮЛЭН орно — ' +
            'терминал өөрөө шийддэг. Ирц ч хэвийн бүртгэгдэнэ.',
        },
      };
    }

    if (err instanceof DigestAuthError) {
      return {
        status: HttpStatus.BAD_GATEWAY,
        body: {
          message: 'Терминалын нэвтрэх нэр/нууц үг буруу байна.',
          error: 'DeviceAuth',
          // ⚠ Энэ нь зүгээр нэг зөвлөгөө биш: Hikvision 5 удаа буруу
          // оруулбал IP-г 30 минут түгжинэ.
          hint:
            'Тохиргоо → Холболт → Терминал дээрээс шалгана уу. ' +
            '⚠ Таамаглаж бүү оролд — 5 удаа буруу оруулбал терминал ' +
            'IP-г 30 минут блоклоно.',
        },
      };
    }

    const isapi = err as IsapiError;
    return {
      status: HttpStatus.BAD_GATEWAY,
      body: {
        message: `Терминал хүсэлтийг биелүүлсэнгүй (${isapi.status}).`,
        error: 'DeviceRejected',
        // Түүхий биеийг богиносгоно — бүтнээр нь дэлгэц рүү шидэхгүй.
        hint: isapi.body ? isapi.body.slice(0, 200) : undefined,
      },
    };
  }
}
