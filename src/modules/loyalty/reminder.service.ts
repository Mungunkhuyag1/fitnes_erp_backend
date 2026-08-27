import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { daysBetween } from '../../common/utils/date.util';
import { Member } from '../member/member.entity';
import { Membership } from '../membership/membership.entity';
import { OutboxService } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import { LOYALTY_TOPICS, loyaltyGroup } from './loyalty-sync.service';
import { LockerAssignment } from '../locker/locker-assignment.entity';
import { ReminderKind, ReminderLog } from './reminder-log.entity';

interface Candidate {
  memberId: string;
  memberNo: number;
  name: string;
  daysLeft: number;
  hasCard: boolean;
  kind: ReminderKind;
  /** Мөчлөгийн түлхүүр — гишүүнчлэл эсвэл шүүгээний олголтын ID. */
  cycleId: string;
  /** Шүүгээний сануулгад «A3» гэж харуулна. */
  lockerLabel?: string;
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
    @InjectRepository(LockerAssignment)
    private readonly assignments: Repository<LockerAssignment>,
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
        hasCard: !!m.loopyCardSerial,
        kind: ReminderKind.MEMBERSHIP,
        cycleId: last.id,
      });
    }

    // ── Шүүгээний түрээс ──
    //
    // Гишүүнчлэлээс ТУСДАА мөчлөг: шинэ түрээс = шинэ олголт = сануулга
    // дахин эхэлнэ. Буцаагдсан (`returned_at`) болон өдрийн шүүгээ
    // (`due_at IS NULL`) хамаарахгүй.
    candidates.push(...(await this.lockerCandidates(wanted, tz)));

    let sent = 0;
    let skippedNoCard = 0;

    for (const c of candidates) {
      const milestone = wanted.get(c.daysLeft)!;
      // Давхардлаас DB-ийн unique index хамгаална — зэрэг ажиллаж ч болно.
      const exists = await this.logs.findOne({
        where:
          c.kind === ReminderKind.LOCKER
            ? { kind: c.kind, lockerAssignmentId: c.cycleId, milestone }
            : { kind: c.kind, membershipId: c.cycleId, milestone },
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
        payload: { memberId: c.memberId, message: this.message(c) },
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
          kind: c.kind,
          membershipId:
            c.kind === ReminderKind.MEMBERSHIP ? c.cycleId : null,
          lockerAssignmentId:
            c.kind === ReminderKind.LOCKER ? c.cycleId : null,
          milestone,
          devices,
        }),
      );
    } catch {
      // unique зөрчил = өөр процесс аль хэдийн илгээсэн. Алдаа биш.
    }
  }

  private message(c: Candidate): string {
    if (c.kind === ReminderKind.LOCKER) {
      const l = c.lockerLabel ? `${c.lockerLabel} шүүгээний` : 'Шүүгээний';
      if (c.daysLeft <= 0) return `${l} түрээс өнөөдөр дуусаж байна.`;
      if (c.daysLeft === 1) {
        return `${l} түрээс маргааш дуусна. Ресепшнд хандана уу.`;
      }
      return `${l} түрээс ${c.daysLeft} хоногийн дараа дуусна. Ресепшнд хандана уу.`;
    }
    if (c.daysLeft <= 0) return 'Таны гишүүнчлэлийн хугацаа өнөөдөр дуусаж байна.';
    if (c.daysLeft === 1) return 'Таны эрх маргааш дуусна. Картаа нээж сунгана уу.';
    return `Таны эрх ${c.daysLeft} хоногийн дараа дуусна. Картаа нээж сунгана уу.`;
  }

  /**
   * Хугацаа нь ойртсон ТҮРЭЭСИЙН шүүгээ.
   *
   * ⚠ JOIN-ы raw мөр рүү хандахгүй. TypeORM-ын `addSelect` нь ENTITY-ийн
   * талбарын нэрийг хүлээдэг (`loopyCardSerial`), DB баганынхыг биш —
   * андуурвал талбар чимээгүй сонгогдохгүй үлдэж, карттай гишүүн
   * «картгүй» гэж бүртгэгдэнэ. Тиймээс гишүүдийг ТУСАД нь ачаална.
   */
  private async lockerCandidates(
    wanted: Map<number, string>,
    tz: string,
  ): Promise<Candidate[]> {
    const maxDays = Math.max(...wanted.keys());
    const rows = await this.assignments.find({
      where: {
        returnedAt: IsNull(),
        // Түрээс л хугацаатай — өдрийн шүүгээнд `due_at` байхгүй.
        dueAt: Between(
          new Date(Date.now() - 86_400_000),
          new Date(Date.now() + (maxDays + 1) * 86_400_000),
        ),
      },
    });
    if (!rows.length) return [];

    const members = await this.members.find({
      where: { id: In([...new Set(rows.map((r) => r.memberId))]) },
      select: {
        id: true,
        memberNo: true,
        name: true,
        status: true,
        loopyCardSerial: true,
      },
    });
    const byId = new Map(members.map((m) => [m.id, m]));

    const now = new Date();
    const out: Candidate[] = [];
    for (const a of rows) {
      const m = byId.get(a.memberId);
      if (!m || m.status === MemberStatus.CANCELLED) continue;
      const daysLeft = daysBetween(now, a.dueAt!, tz);
      if (!wanted.has(daysLeft)) continue;
      out.push({
        memberId: m.id,
        memberNo: m.memberNo,
        name: m.name,
        daysLeft,
        hasCard: !!m.loopyCardSerial,
        kind: ReminderKind.LOCKER,
        cycleId: a.id,
        lockerLabel: `${a.lockerZone}${a.lockerNumber}`,
      });
    }
    return out;
  }
}
