import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SendInput {
  to: string;
  subject: string;
  html: string;
}

export interface SendResult {
  id: string | null;
  stub: boolean;
}

/**
 * Мэйл илгээгч — Resend.
 *
 * ★ ЯАГААД RESEND ВЭ
 *
 * Үнэгүй багц нь 3,000/сар · 100/өдөр бөгөөд ЭНЭ хэрэглээнд элбэг
 * (админд өдөрт 20–50 мэдэгдэл). Домэйн үнэгүй багцад ажиллана.
 * SendGrid, Mailgun хоёр үнэгүй багцаа хассан тул тооцох шаардлагагүй.
 * Өдрийн 100 хязгаар багдвал Brevo (300/өдөр) руу шилжинэ.
 *
 * ⚠ Домэйн эзэмшдэг нь ХАНГАЛТГҮЙ: `winfit.mn`-ий DNS дээр SPF ба DKIM
 * бичлэг нэмэхгүй бол мэйл спам руу орно.
 */
@Injectable()
export class MailProvider {
  private readonly log = new Logger(MailProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get stubMode(): boolean {
    return this.config.get<string>('mail.mode') !== 'live';
  }

  /** Тохируулагдсан эсэх — дэлгэцэд «идэвхтэй юу» гэж харуулна. */
  get configured(): boolean {
    return (
      !this.stubMode &&
      !!this.config.get<string>('mail.apiKey') &&
      !!this.config.get<string>('mail.from')
    );
  }

  async send(input: SendInput): Promise<SendResult> {
    // Stub горимд ЖИНХЭНЭ хаяг руу юу ч явахгүй. Хөгжүүлэлтийн үед
    // санамсаргүй мэйл илгээх нь буцаах боломжгүй алдаа.
    if (this.stubMode) {
      this.log.log(`Мэйл (stub) → ${input.to}: ${input.subject}`);
      return { id: null, stub: true };
    }

    const key = this.config.getOrThrow<string>('mail.apiKey');
    const from = this.config.getOrThrow<string>('mail.from');

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    if (!res.ok) {
      // Түүхий хариуг дамжуулна — «алдаа гарлаа» гэхээс илүү
      // «домэйн баталгаажаагүй» гэдэг нь юу засахыг хэлнэ.
      throw new Error(`Resend ${res.status}: ${text.slice(0, 300)}`);
    }
    const body = JSON.parse(text) as { id?: string };
    return { id: body.id ?? null, stub: false };
  }
}
