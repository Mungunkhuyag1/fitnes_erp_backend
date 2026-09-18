import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceConnectionService } from './device-connection.service';
import { DigestClient } from './isapi/digest';
import { isSafeTerminalPath } from './isapi/terminal-path';

/**
 * Терминал дээрх зургийг дамжуулж өгнө.
 *
 * ★ ЯАГААД ДАМЖУУЛАХ ВЭ, ШУУД ХОЛБООС БИШ
 *
 * Терминалын зураг нь digest нэвтрэлт шаарддаг бөгөөд ихэвчлэн ЛОКАЛ
 * сүлжээнд л хүрдэг. Браузер руу шууд хаяг өгвөл: нууц үг хаягт орно,
 * гаднаас нээгдэхгүй, IP солигдоход эвдэрнэ.
 *
 * ★ ХАДГАЛАХГҮЙ
 *
 * Байтыг DB-д ч, дискэнд ч хадгалахгүй — хэрэгтэй үед татна. Ингэснээр
 * сан томрохгүй. Сул тал: терминалын санах ой дүүрэхэд хуучин зураг
 * дарагдаж, зам нь үлдсэн ч олдохгүй болно.
 */
@Injectable()
export class DeviceImageService {
  private readonly log = new Logger(DeviceImageService.name);

  constructor(
    private readonly address: DeviceConnectionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * @param path `/LOCALS/...` хэлбэрийн ДОТООД зам
   */
  async fetch(
    path: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    /*
     * ⚠ Замыг ДАХИН шалгана. Хадгалах үед шалгасан ч энэ нь нийтийн
     * параметр: `/ISAPI/...` руу заавал терминалын өөр үйлдлийг
     * дуудах оролдлого болно.
     */
    if (!isSafeTerminalPath(path)) {
      throw new NotFoundException('Зургийн зам буруу байна');
    }

    if (this.config.get<string>('gateways.device') === 'stub') {
      throw new NotFoundException(
        'Stub горимд зураг байхгүй — DEVICE_GATEWAY=direct эсвэл agent болгоно уу',
      );
    }

    const cfg = await this.address.connection();
    if (!cfg) {
      throw new NotFoundException('Терминалын хаяг тодорхойгүй');
    }

    const scheme = cfg.https ? 'https' : 'http';
    const port = cfg.port ?? (cfg.https ? 443 : 80);
    const client = new DigestClient(`${scheme}://${cfg.host}:${port}`, {
      user: cfg.user,
      password: cfg.password,
      timeoutMs: 10_000,
      defaultHeaders: cfg.headers,
    });

    let res: { status: number; bytes: Buffer; contentType: string | null };
    try {
      res = await client.requestBytes('GET', path);
    } catch (e) {
      /*
       * ⚠ Сүлжээний алдааг БАРИНА. `fetch` нь терминал хүрэхгүй,
       * хугацаа хэтрэх үед `DOMException`/`TypeError` шиддэг бөгөөд
       * Nest түүнийг «Internal server error» болгодог: дэлгэц дээр
       * ЯАГААД гэдэг нь харагдахгүй.
       */
      const detail = e instanceof Error ? e.message : String(e);
      const message = `Терминал руу холбогдож чадсангүй (${cfg.host}): ${detail}`;
      this.log.warn(message);
      throw new ServiceUnavailableException(message);
    }
    if (res.status !== 200 || !res.bytes.length) {
      // Хуучин зураг дарагдсан байх нь ХЭВИЙН — алдаа гэж бүртгэхгүй.
      this.log.debug(`Зураг олдсонгүй (${res.status}): ${path}`);
      throw new NotFoundException('Зураг олдсонгүй — терминал дээр дарагдсан байж болно');
    }
    return {
      bytes: res.bytes,
      contentType: res.contentType ?? 'image/jpeg',
    };
  }
}
