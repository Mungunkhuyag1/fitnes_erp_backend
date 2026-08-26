import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { normalizePhone } from '../../common/utils/phone.util';
import { Member } from '../member/member.entity';
import { OutboxService } from '../outbox/outbox.service';
import { LOYALTY_TOPICS, loyaltyGroup } from './loyalty-sync.service';

/** Webhook-ийн timestamp хэр хуучин байхыг зөвшөөрөх (секунд). */
const WEBHOOK_TOLERANCE_SEC = 300;

/**
 * Loopy-гаас ирэх webhook.
 *
 * Гол эвент: `card.enrolled` — гишүүн Wallet карт үүсгэмэгц Loopy мэдэгдэнэ.
 * Тэр агшинд WinFit нь картын `serialNumber`-ыг хадгалж, ЖИНХЭНЭ эрхийн
 * огноог картад дарж бичнэ (Loopy тал программын `validityDays`-аар тооцсон
 * огноотой байдаг — docs/06-loopy-partner-api.md §3.2).
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/loopy')
export class LoyaltyWebhookController {
  private readonly log = new Logger(LoyaltyWebhookController.name);

  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody?.toString('utf8') ?? '';
    this.verify(req, raw);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('JSON буруу');
    }

    const event = String(payload.event ?? payload.type ?? '');
    const data = (payload.data ?? payload.payload ?? payload) as Record<
      string,
      unknown
    >;
    this.log.log(`Loopy webhook: ${event}`);

    if (event !== 'card.enrolled') {
      // Бусад эвент (sale.recorded, reward.redeemed) WinFit-д хамаагүй.
      return { ok: true, ignored: true };
    }

    const serial = data.serialNumber as string | undefined;
    const phone = normalizePhone(data.phone as string | undefined);
    if (!serial || !phone) {
      this.log.warn('card.enrolled: serialNumber/phone дутуу');
      return { ok: true };
    }

    // ★ Нэг байгууллага олон программтай байж болно (кофены тамга, оноо г.м.).
    // Programme-ыг шалгахгүй бол гишүүн ӨӨР программын карт үүсгэхэд түүний
    // `loopyCardSerial`-ыг дарж бичих ба цаашид эрхийн огноо, төлбөрийн линк
    // БУРУУ карт руу явна.
    const ourProgram = this.config.get<string>('loopy.programId');
    const cardProgram = data.programId as string | undefined;
    if (ourProgram && cardProgram && cardProgram !== ourProgram) {
      this.log.debug(`card.enrolled: өөр программын карт (${cardProgram}) — алгаслаа`);
      return { ok: true, ignored: true };
    }

    const member = await this.members.findOne({ where: { phone } });
    if (!member) {
      // Loopy дээр өөр эх сурвалжаар үүссэн карт байж болно — алдаа биш.
      this.log.warn(`card.enrolled: ${phone} дугаартай гишүүн олдсонгүй`);
      return { ok: true };
    }
    if (member.loopyCardSerial === serial) {
      return { ok: true, already: true };
    }

    member.loopyCardSerial = serial;
    member.loopyCustomerId = (data.customerId as string) ?? null;
    await this.members.save(member);

    // ★ Loopy-гийн карт нь программын `validityDays`-аар тооцсон огноотой
    // үүсдэг. Жинхэнэ эрх WinFit-д байгаа тул ТЭР ДАРУЙ дарж бичнэ. Мөн
    // картын ард «Эрх сунгах» линкийг тавина.
    await this.outbox.enqueue([
      {
        topic: LOYALTY_TOPICS.EXTEND,
        payload: { memberId: member.id },
        groupKey: loyaltyGroup(member.id),
      },
      {
        topic: LOYALTY_TOPICS.FIELDS,
        payload: { memberId: member.id },
        groupKey: loyaltyGroup(member.id),
      },
    ]);

    this.log.log(`Карт холбогдлоо: №${member.memberNo} ${member.name} → ${serial}`);
    return { ok: true };
  }

  /**
   * HMAC гарын үсгийг шалгана — Loopy-гийн илгээдэг ЯГ ТЭР хэлбэрээр.
   *
   * Loopy (`webhook.service.ts`) дараах байдлаар илгээнэ:
   *   X-Loopy-Timestamp: <unix секунд>
   *   X-Loopy-Signature: sha256=<hex>
   *   гарын үсэг = HMAC-SHA256(secret, `${ts}.${body}`)
   *
   * Гурван нарийн зүйл:
   *   • `sha256=` угтварыг ЗААВАЛ хасна — эс бөгөөс урт нь таарахгүй
   *   • timestamp гарын үсэгт ОРНО — зөвхөн биеийг гарын үсэглэвэл таарахгүй
   *   • хуучин хүсэлтийг дахин илгээхээс сэргийлж хугацааг шалгана
   *
   * Secret тохируулаагүй бол алгасна (stub/хөгжүүлэлтэд).
   */
  private verify(req: Request, raw: string): void {
    const secret = this.config.get<string>('loopy.webhookSecret');
    if (!secret) return;

    const header = (name: string): string | undefined => {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const rawSig = header('x-loopy-signature') ?? header('x-signature');
    if (!rawSig) throw new UnauthorizedException('Гарын үсэг алга');

    const ts = header('x-loopy-timestamp');
    if (!ts || !/^\d+$/.test(ts)) {
      throw new UnauthorizedException('Timestamp алга');
    }
    // Дахин илгээх довтолгооноос хамгаална. 5 минутын зөрүү нь сервер
    // хоорондын цагийн бага зэргийн зөрүүг тэсвэрлэхэд хангалттай.
    const ageSec = Math.abs(Date.now() / 1000 - Number(ts));
    if (ageSec > WEBHOOK_TOLERANCE_SEC) {
      throw new UnauthorizedException('Хүсэлтийн хугацаа хэтэрсэн');
    }

    const sig = rawSig.trim().toLowerCase().replace(/^sha256=/, '');
    const digest = createHmac('sha256', secret)
      .update(`${ts}.${raw}`, 'utf8')
      .digest('hex');
    const a = Buffer.from(digest);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Гарын үсэг таарахгүй');
    }
  }
}
