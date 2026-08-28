import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermanentError } from '../outbox/outbox.errors';
import { OutboxRegistry } from '../outbox/outbox.registry';
import { OutboxService } from '../outbox/outbox.service';
import { EmailLog, MailEvent, NotificationRecipient } from './mail.entity';
import { MailProvider } from './mail.provider';

export const MAIL_TOPIC = 'mail.send';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly log = new Logger(MailService.name);

  constructor(
    @InjectRepository(NotificationRecipient)
    private readonly recipients: Repository<NotificationRecipient>,
    @InjectRepository(EmailLog) private readonly logs: Repository<EmailLog>,
    private readonly provider: MailProvider,
    private readonly outbox: OutboxService,
    private readonly registry: OutboxRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(MAIL_TOPIC, (p) =>
      this.deliver(
        String(p.to),
        String(p.subject),
        String(p.html),
        String(p.template ?? 'raw'),
      ),
    );
  }

  /**
   * Тухайн эвентэд бүртгэлтэй хүн бүрд дараалалд оруулна.
   *
   * ★ ЯАГААД OUTBOX-ООР ВЭ
   *
   * Мэйлийн үйлчилгээ түр унах нь энгийн зүйл. Шууд илгээвэл тэр
   * мэдэгдэл БҮРМӨСӨН алдагдана. Outbox нь дахин оролдлого, backoff,
   * «бүтэлгүйтсэн» дэлгэцтэй — шинээр юу ч бичих шаардлагагүй.
   */
  async notify(
    event: MailEvent,
    subject: string,
    html: string,
    template = 'generic',
  ): Promise<number> {
    const rows = await this.recipients.find({ where: { active: true } });
    const targets = rows.filter((r) => r.events.includes(event));
    if (!targets.length) {
      this.log.debug(`${event}: хүлээн авагч алга — алгаслаа`);
      return 0;
    }

    for (const r of targets) {
      await this.outbox.enqueue({
        topic: MAIL_TOPIC,
        payload: { to: r.email, subject, html, template },
        // Хүн бүрийн мэйл ТУСАД нь дараалалд — нэг хаяг унавал бусад
        // нь саатах ёсгүй.
        groupKey: `mail:${r.email}`,
      });
    }
    return targets.length;
  }

  /** Нэг хаяг руу шууд — туршилтад. */
  async sendOne(
    to: string,
    subject: string,
    html: string,
    template = 'test',
  ): Promise<{ ok: boolean; stub: boolean; detail?: string }> {
    try {
      const r = await this.provider.send({ to, subject, html });
      await this.record(to, subject, template, r.stub ? 'stub' : 'sent', r.id, null);
      return { ok: true, stub: r.stub };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Алдаа';
      await this.record(to, subject, template, 'failed', null, msg);
      return { ok: false, stub: false, detail: msg };
    }
  }

  /** Outbox-ийн handler — амжилтгүй бол ШИДНЭ, тэр нь дахин оролдоно. */
  private async deliver(
    to: string,
    subject: string,
    html: string,
    template: string,
  ): Promise<void> {
    if (!to.includes('@')) {
      // Хаяг буруу бол дахин оролдох утгагүй — шууд `failed`.
      throw new PermanentError(`Мэйл хаяг буруу: ${to}`);
    }
    try {
      const r = await this.provider.send({ to, subject, html });
      await this.record(to, subject, template, r.stub ? 'stub' : 'sent', r.id, null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Алдаа';
      await this.record(to, subject, template, 'failed', null, msg);
      throw e;
    }
  }

  private async record(
    toEmail: string,
    subject: string,
    template: string,
    status: string,
    providerId: string | null,
    error: string | null,
  ): Promise<void> {
    await this.logs.save(
      this.logs.create({
        toEmail,
        subject: subject.slice(0, 300),
        template,
        status,
        providerId,
        error: error?.slice(0, 500) ?? null,
      }),
    );
  }
}
