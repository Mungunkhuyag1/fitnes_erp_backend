import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CreateRecipientDto, UpdateRecipientDto } from './dto/mail.dto';
import {
  EmailLog,
  MAIL_EVENT_LABEL,
  MailEvent,
  NotificationRecipient,
} from './mail.entity';
import { MailProvider } from './mail.provider';
import { MailService } from './mail.service';
import { testMail } from './mail.template';

@Injectable()
export class MailRecipientService {
  constructor(
    @InjectRepository(NotificationRecipient)
    private readonly repo: Repository<NotificationRecipient>,
    @InjectRepository(EmailLog) private readonly logs: Repository<EmailLog>,
    private readonly provider: MailProvider,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async list() {
    const rows = await this.repo.find({ order: { createdAt: 'ASC' } });
    return {
      // Дэлгэц «яагаад мэйл ирэхгүй байна вэ» гэдгийг ЭНДЭЭС мэднэ:
      // хаяг бүртгэлтэй ч горим stub бол юу ч явахгүй.
      configured: this.provider.configured,
      // Ямар дүнгээс дээш шууд мэдэгдэхийг ажилтан ХАРАХ ёстой —
      // эс бөгөөс «яагаад энэ төлбөрт мэйл ирээгүй вэ» гэж гайхна.
      largePaymentFrom: this.config.get<number>('mail.largePayment') ?? 0,
      events: Object.entries(MAIL_EVENT_LABEL).map(([value, label]) => ({
        value,
        label,
      })),
      recipients: rows,
    };
  }

  async create(dto: CreateRecipientDto): Promise<NotificationRecipient> {
    const email = dto.email.trim().toLowerCase();
    if (await this.repo.findOne({ where: { email } })) {
      throw new ConflictException('Энэ хаяг бүртгэлтэй байна');
    }
    return this.repo.save(
      this.repo.create({
        email,
        name: dto.name?.trim() || null,
        events: dto.events,
        active: true,
      }),
    );
  }

  async update(
    id: string,
    dto: UpdateRecipientDto,
  ): Promise<NotificationRecipient> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Хүлээн авагч олдсонгүй');
    if (dto.name !== undefined) r.name = dto.name.trim() || null;
    if (dto.events !== undefined) r.events = dto.events;
    if (dto.active !== undefined) r.active = dto.active;
    return this.repo.save(r);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const res = await this.repo.delete(id);
    if (!res.affected) throw new NotFoundException('Хүлээн авагч олдсонгүй');
    return { ok: true as const };
  }

  /**
   * Туршилтын мэйл — тохиргоо зөв эсэхийг шалгана.
   *
   * ⚠ Outbox-оор БИШ, ШУУД илгээнэ: ажилтан «ажиллаж байна уу» гэдгийг
   * тэр даруй мэдэх ёстой. Дараалалд оруулбал алдааны шалтгаан нь
   * өөр дэлгэц рүү оршино.
   */
  async sendTest(email?: string) {
    const to = email?.trim().toLowerCase();
    if (!to) {
      const first = await this.repo.findOne({ where: { active: true } });
      if (!first) {
        throw new NotFoundException('Эхлээд хүлээн авагч нэмнэ үү');
      }
      return this.mail.sendOne(first.email, ...this.test());
    }
    return this.mail.sendOne(to, ...this.test());
  }

  private test(): [string, string, string] {
    const t = testMail();
    return [t.subject, t.html, 'test'];
  }

  /** Сүүлийн 50 илгээлт — «явсан уу» гэдгийг шалгах. */
  recentLog(): Promise<EmailLog[]> {
    return this.logs.find({ order: { sentAt: 'DESC' }, take: 50 });
  }
}

export { MailEvent };
