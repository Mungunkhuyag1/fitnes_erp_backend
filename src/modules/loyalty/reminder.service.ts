import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { daysBetween } from '../../common/utils/date.util';
import { Member } from '../member/member.entity';
import { Membership } from '../membership/membership.entity';
import { OutboxService } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import { LOYALTY_TOPICS, loyaltyGroup } from './loyalty-sync.service';
import { ReminderLog } from './reminder-log.entity';

interface Candidate {
  memberId: string;
  memberNo: number;
  name: string;
  daysLeft: number;
  membershipId: string;
  hasCard: boolean;
}

/**
 * Эрх дуусах сануулга — Wallet push-аар.
 *
 * SMS/и-мэйл БИШ (шийдвэр 6): гишүүн картаа нээхэд «Эрх сунгах» линк ард нь
 * бэлэн байдаг тул мэдэгдлээс шууд төлбөр рүү орно.
 *
 * ⚠ Картгүй гишүүнд ХҮРЭХГҮЙ. Тэднийг нүүр хуудасны «Удахгүй дуусах ·
 * картгүй N» жагсаалтаас ресепшн залгана.
 */
@Injectable()
export class ReminderService {
  private readonly log = new Logger(ReminderService.name);

  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(Membership)
    private readonly memberships: Repository<Membership>,
    @InjectRepository(ReminderLog)
    private readonly logs: Repository<ReminderLog>,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /** Өдөр бүр 09:00 (локал) — шөнө мэдэгдэл илгээхгүй. */
  @Cron('0 9 * * *', { name: 'send-reminders', timeZone: 'Asia/Ulaanbaatar' })
  async tick(): Promise<{ sent: number; skippedNoCard: number }> {
    return this.run();
  }

  async run(): Promise<{ sent: number; skippedNoCard: number }> {
    const milestones = await this.settings.get('reminder_milestones');
    if (!milestones.length) return { sent: 0, skippedNoCard: 0 };

    const tz = this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
    const wanted = new Map<number, string>();
    for (const m of milestones) {
      // `T-7` → 7, `T0` → 0
      const n = m === 'T0' ? 0 : Number(m.replace('T-', ''));
      if (Number.isFinite(n)) wanted.set(n, m);
    }
    const maxDays = Math.max(...wanted.keys());

    const rows = await this.members
      .createQueryBuilder('m')
      .where('m.status = :st', { st: MemberStatus.ACTIVE })
      .andWhere('m.access_ends_at IS NOT NULL')
      .andWhere('m.access_ends_at <= :until', {
        until: new Date(Date.now() + (maxDays + 1) * 86_400_000),
      })
      // Өчигдөр дууссаныг ч оруулна — `T0` цэг өнөөдөр таарч болно.
      .andWhere('m.access_ends_at >= :from', {
        from: new Date(Date.now() - 86_400_000),
      })
      .getMany();

    const now = new Date();
    const candidates: Candidate[] = [];
    for (const m of rows) {
      const daysLeft = daysBetween(now, m.accessEndsAt!, tz);
      if (!wanted.has(daysLeft)) continue;
      // Тухайн эрхийг үүсгэсэн СҮҮЛИЙН худалдан авалт = мөчлөгийн түлхүүр.
      const last = await this.memberships.findOne({
        where: { memberId: m.id },
        order: { createdAt: 'DESC' },
      });
      if (!last) continue;
      candidates.push({
        memberId: m.id,
        memberNo: m.memberNo,
        name: m.name,
        daysLeft,
        membershipId: last.id,
        hasCard: !!m.loopyCardSerial,
      });
    }

    let sent = 0;
    let skippedNoCard = 0;

    for (const c of candidates) {
      const milestone = wanted.get(c.daysLeft)!;
      // Давхардлаас DB-ийн unique index хамгаална — зэрэг ажиллаж ч болно.
      const exists = await this.logs.findOne({
        where: { membershipId: c.membershipId, milestone },
      });
      if (exists) continue;

      if (!c.hasCard) {
        skippedNoCard++;
        // Бүртгэлд үлдээнэ — дахин дахин шалгахгүй, мөн тайланд харагдана.
        await this.saveLog(c, milestone, 0);
        continue;
      }

      await this.outbox.enqueue({
        topic: LOYALTY_TOPICS.PUSH,
        payload: { memberId: c.memberId, message: this.message(c.daysLeft) },
        groupKey: loyaltyGroup(c.memberId),
      });
      await this.saveLog(c, milestone, 1);
      sent++;
    }

    if (sent || skippedNoCard) {
      this.log.log(
        `Сануулга: ${sent} илгээв, ${skippedNoCard} картгүй (залгах шаардлагатай)`,
      );
    }
    return { sent, skippedNoCard };
  }

  private async saveLog(c: Candidate, milestone: string, devices: number) {
    try {
      await this.logs.save(
        this.logs.create({
          memberId: c.memberId,
          membershipId: c.membershipId,
          milestone,
          devices,
        }),
      );
    } catch {
      // unique зөрчил = өөр процесс аль хэдийн илгээсэн. Алдаа биш.
    }
  }

  private message(daysLeft: number): string {
    if (daysLeft <= 0) return 'Таны гишүүнчлэлийн хугацаа өнөөдөр дуусаж байна.';
    if (daysLeft === 1) return 'Таны эрх маргааш дуусна. Картаа нээж сунгана уу.';
    return `Таны эрх ${daysLeft} хоногийн дараа дуусна. Картаа нээж сунгана уу.`;
  }
}
