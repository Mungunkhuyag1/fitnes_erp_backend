import {
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import type { MetaAttachment } from './meta-message.entity';
import { MetaService } from './meta.service';

/** Meta-гийн илгээдэг нэг үйл явдал. */
interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: MetaAttachment[];
  };
}

interface WebhookBody {
  object?: string;
  entry?: { id?: string; time?: number; messaging?: MessagingEvent[] }[];
}

/**
 * Facebook Messenger-ийн түлхэлт.
 *
 * ★ ХОЁР ЗАМ, ХОЁР ЗОРИЛГО
 *
 *  · `GET`  — Meta-гийн хаягийн баталгаажуулалт (`hub.challenge`)
 *  · `POST` — мессеж хүлээж авах
 *
 * ★ ГАРЫН ҮСЭГ НЬ ТҮҮХИЙ БАЙТ ДЭЭР
 *
 * `X-Hub-Signature-256` нь БИЕИЙН ТҮҮХИЙ байт дээр тооцогддог. JSON
 * задлагч ажилласан бол дахин цуглуулсан текст нь эх хувилбартай
 * таарахгүй (зай, escape, талбарын дараалал) — гарын үсэг ҮРГЭЛЖ
 * буруу гарна. Тиймээс `main.ts` дээр энэ замд `raw()` бүртгэнэ.
 *
 * ⚠ 5 СЕКУНДЫН ДОТОР 200 БУЦААНА. Meta удаан хариу өгвөл дахин
 * илгээдэг ба дараалан бүтэлгүйтвэл захиалгыг унтраадаг. Хүнд ажлыг
 * энд хийхгүй.
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/meta')
export class MetaWebhookController {
  private readonly log = new Logger(MetaWebhookController.name);

  constructor(private readonly meta: MetaService) {}

  /**
   * Хаягийн баталгаажуулалт.
   *
   * Meta нь webhook хаягийг бүртгэхэд НЭГ УДАА энд ирж, `hub.challenge`
   * -ийг эргүүлж буцаахыг шаарддаг.
   */
  @Get()
  /*
   * ⚠ ТЕКСТЭЭР БУЦААНА.
   *
   * Meta нь биеийг `hub.challenge`-тэй ЯГ тааруулж шалгадаг.
   * JSON болговол хашилт нэмэгдэж баталгаажуулалт УНАНА.
   *
   * Nest нь мөр буцаахад `response.send(String(body))` гэж түүхийгээр
   * илгээдэг тул одоогоор зөв. Гэвч хожим хариуг бүрхдэг
   * глобал interceptor нэмэгдвэл чимээгүй эвдэрнэ — тиймээс ил.
   */
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): Promise<string> {
    const expected = await this.meta.verifyToken();
    if (!expected) {
      this.log.warn('Баталгаажуулалт ирлээ ч хуудас холбогдоогүй байна');
      throw new UnauthorizedException();
    }
    if (mode !== 'subscribe' || token !== expected) {
      this.log.warn(`Баталгаажуулалт таарсангүй (mode=${mode})`);
      throw new UnauthorizedException();
    }
    this.log.log('Facebook webhook хаяг баталгаажлаа');
    return challenge;
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request): Promise<{ ok: true }> {
    const raw = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from(typeof req.body === 'string' ? req.body : '');

    await this.assertSignature(req, raw);

    let body: WebhookBody;
    try {
      body = JSON.parse(raw.toString('utf8')) as WebhookBody;
    } catch {
      this.log.warn('Түлхэлтийн бие JSON биш байна');
      return { ok: true };
    }

    // Зөвхөн хуудасны үйл явдал. Instagram нэмбэл энд өргөтгөнө.
    if (body.object !== 'page') return { ok: true };

    let stored = 0;
    for (const entry of body.entry ?? []) {
      const pageId = entry.id;
      if (!pageId) continue;

      for (const ev of entry.messaging ?? []) {
        const m = ev.message;
        if (!m?.mid) continue;

        /*
         * ★ ЦУУРАЙ (`is_echo`) — ХУУДАСНААС ИЛГЭЭСЭН МЕССЕЖ.
         *
         * Business Suite, гар утас, эсвэл WinFit-ээс илгээсэн БҮХ
         * мессеж энэ хэлбэрээр буцаж ирдэг. Үүнийг бүртгэхгүй бол
         * ажилтан утсаараа хариулмагц хайрцаг зөрнө.
         *
         * Цуурай дээр `sender` нь ХУУДАС, `recipient` нь хүн —
         * ирсэн мессежийн ЭСРЭГ. Тиймээс psid-г зөв талаас нь авна.
         */
        const echo = m.is_echo === true;
        const psid = echo ? ev.recipient?.id : ev.sender?.id;
        if (!psid || psid === pageId) continue;

        const ok = await this.meta.ingest({
          pageId,
          psid,
          mid: m.mid,
          direction: echo ? 'out' : 'in',
          text: m.text ?? null,
          attachments: m.attachments?.length ? m.attachments : null,
          sentAt: new Date(ev.timestamp ?? Date.now()),
        });
        if (ok) stored++;
      }
    }

    if (stored) this.log.log(`Messenger: ${stored} шинэ мессеж`);
    return { ok: true };
  }

  /**
   * `X-Hub-Signature-256` шалгах.
   *
   * ⚠ App secret тохируулаагүй бол ХҮЛЭЭЖ АВАХГҮЙ. Гарын үсэггүй
   * webhook нь хэн ч мессеж «үүсгэх» боломж олгоно.
   */
  private async assertSignature(req: Request, raw: Buffer): Promise<void> {
    const secret = await this.meta.appSecret();
    if (!secret) {
      this.log.warn('App secret тохируулаагүй тул түлхэлт хүлээж авахгүй');
      throw new UnauthorizedException('Тохиргоо дутуу');
    }

    const header = req.headers['x-hub-signature-256'];
    const rawSig = Array.isArray(header) ? header[0] : header;
    if (!rawSig) throw new UnauthorizedException('Гарын үсэг алга');

    const sig = rawSig.trim().toLowerCase().replace(/^sha256=/, '');
    const digest = createHmac('sha256', secret).update(raw).digest('hex');

    const a = Buffer.from(digest);
    const b = Buffer.from(sig);
    // ⚠ Урт нь зөрвөл `timingSafeEqual` шидэх тул урьдчилж шалгана.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Гарын үсэг таарахгүй');
    }
  }
}
