import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  MemberStatus,
  MembershipSource,
} from '../../common/enums/member-status.enum';
import { AuditService } from '../audit/audit.service';
import { Member } from '../member/member.entity';
import { MembershipService } from '../membership/membership.service';
import { SettingsService } from '../settings/settings.service';
import { Freeze, FreezeApplication, FreezeScope } from './freeze.entity';

/** Хоногийн зөрүү — эхлэл ба төгсгөлийн хооронд. */
const daysBetween = (a: Date, b: Date): number =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));

/**
 * Чөлөө.
 *
 * ★ ХОЁР ТЭС ӨӨР ХЭРЭГЛЭЭ
 *
 * • БАЯРЫН (`global`) — заалан хаагдсан тул бүх идэвхтэй гишүүнд нөхөн
 *   олгоно. Нэвтрэлт хаах шаардлагагүй: заалан хаалттай байсан.
 *
 * • ХУВЬ ХҮНИЙ (`member`) — гишүүн гадаадад явсан, гэмтсэн. Энэ үед
 *   нэвтрэлтийг ХААНА, эс бөгөөс чөлөөтэй байхдаа дасгал хийгээд дараа
 *   нь нэмэгдсэн хоногоо авах болно.
 *
 * ★ ХОНОГИЙГ ДЭВТЭРТ БИЧНЭ
 *
 * `access_ends_at`-д шууд нэмэх нь БОЛОХГҮЙ: `recompute()` нь түүнийг
 * `memberships`-аас дахин тооцдог тул дараагийн тооцоололд арилна.
 * Тиймээс 0₮-ийн `source='freeze'` мөр үүсгэнэ — тайлан үүнийг
 * худалдан авалт гэж тоолохгүй.
 */
@Injectable()
export class FreezeService {
  private readonly log = new Logger(FreezeService.name);

  constructor(
    @InjectRepository(Freeze) private readonly repo: Repository<Freeze>,
    @InjectRepository(FreezeApplication)
    private readonly apps: Repository<FreezeApplication>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly ds: DataSource,
    private readonly memberships: MembershipService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // ══════════════════════════════════════════════════════════════
  //  Баярын чөлөө
  // ══════════════════════════════════════════════════════════════

  /**
   * Бүх идэвхтэй гишүүнд нөхөн олгоно.
   *
   * ⚠ Идемпотент: `freeze_applications`-ийн UNIQUE нь давхар олголтоос
   * сэргийлнэ. Дахин дуудвал ЗӨВХӨН шинэ гишүүд нэмэгдэнэ.
   */
  async createGlobal(
    input: { reason: string; startsAt: Date; endsAt: Date },
    user: AuthUser,
  ): Promise<{
    freezeId: string;
    applied: number;
    days: number;
    already?: boolean;
  }> {
    const days = daysBetween(input.startsAt, input.endsAt) + 1;
    if (days < 1 || days > 90) {
      throw new BadRequestException('Хугацаа 1–90 хоног байна');
    }

    // ⚠ Ижил хугацаатай баярын чөлөө АЛЬ ХЭДИЙН байвал шинийг үүсгэхгүй.
    // Ажилтан товчийг хоёр удаа дарах нь («дарагдсан уу?») хамгийн
    // магадлалтай алдаа — тэр үед гишүүн бүр 2 хоног авах байлаа.
    const existing = await this.repo.findOne({
      where: {
        scope: FreezeScope.GLOBAL,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
    });
    if (existing) {
      // Дутуу олгогдсон байж болно (шинэ гишүүн нэмэгдсэн, эсвэл нэг
      // мөр унасан) тул дахин ажиллуулна — олголт нь идемпотент.
      const filled = await this.apply(existing, existing.days);
      this.log.warn(
        `Ижил хугацаатай баярын чөлөө бий — шинээр үүсгэсэнгүй (нөхөв: ${filled})`,
      );
      return {
        freezeId: existing.id,
        applied: filled,
        days: existing.days,
        already: true as const,
      };
    }

    const freeze = await this.repo.save(
      this.repo.create({
        scope: FreezeScope.GLOBAL,
        memberId: null,
        reason: input.reason.trim(),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        days,
        createdBy: user.id,
        // Баярын чөлөө нь тэр даруй олгогдоно — «дуусах» гэж хүлээхгүй.
        endedAt: new Date(),
        endedBy: user.id,
      }),
    );

    const applied = await this.apply(freeze, days);
    await this.audit.record({
      staffUserId: user.id,
      action: 'freeze.global',
      entity: 'settings',
      entityId: freeze.id,
      after: { reason: freeze.reason, days, applied },
    });
    this.log.log(`Баярын чөлөө: ${applied} гишүүнд +${days} хоног`);
    return { freezeId: freeze.id, applied, days };
  }

  // ══════════════════════════════════════════════════════════════
  //  Хувь хүний чөлөө
  // ══════════════════════════════════════════════════════════════

  async createMember(
    input: { memberId: string; days: number; reason: string },
    user: AuthUser,
  ): Promise<Freeze> {
    const member = await this.members.findOne({ where: { id: input.memberId } });
    if (!member) throw new NotFoundException('Гишүүн олдсонгүй');
    if (member.status !== MemberStatus.ACTIVE) {
      throw new BadRequestException(
        'Зөвхөн идэвхтэй гишүүнд чөлөө олгоно — хугацаа дууссан хүнд утгагүй',
      );
    }
    if (await this.openOf(input.memberId)) {
      throw new BadRequestException('Энэ гишүүн аль хэдийн чөлөөтэй байна');
    }

    const [min, max, perYear] = await Promise.all([
      this.settings.get('freeze_min_days'),
      this.settings.get('freeze_max_once'),
      this.settings.get('freeze_days_per_year'),
    ]);
    if (input.days < min) {
      throw new BadRequestException(`Хамгийн багадаа ${min} хоног`);
    }
    if (input.days > max) {
      throw new BadRequestException(`Нэг удаад дээд тал нь ${max} хоног`);
    }

    const used = await this.usedThisYear(input.memberId);
    if (perYear > 0 && used + input.days > perYear) {
      throw new BadRequestException(
        `Жилийн хязгаар ${perYear} хоног — энэ гишүүн ${used} хоног авсан байна`,
      );
    }

    const now = new Date();
    const freeze = await this.repo.save(
      this.repo.create({
        scope: FreezeScope.MEMBER,
        memberId: input.memberId,
        reason: input.reason.trim(),
        startsAt: now,
        endsAt: new Date(now.getTime() + input.days * 86_400_000),
        days: input.days,
        createdBy: user.id,
      }),
    );

    // Нэвтрэлтийг ХААНА — эс бөгөөс чөлөөтэй байхдаа дасгал хийнэ.
    await this.memberships.suspend(
      input.memberId,
      `Чөлөө: ${freeze.reason}`,
      user,
    );

    await this.audit.record({
      staffUserId: user.id,
      action: 'freeze.start',
      entity: 'member',
      entityId: input.memberId,
      after: { days: input.days, reason: freeze.reason, until: freeze.endsAt },
    });
    return freeze;
  }

  /**
   * Чөлөөг дуусгах — хугацаа дуусах эсвэл ГАРААР эрт.
   *
   * ⚠ БОДИТООР өнгөрсөн хоногийг л нөхнө. 14 хоногийн чөлөө авчихаад
   * 5 дахь өдөр буцаж ирвэл 5 хоног нэмнэ, 14 биш — эс бөгөөс эрт
   * дуусгах нь гишүүнд ашиггүй болж, хэн ч гараар дуусгахгүй.
   */
  async end(
    freezeId: string,
    user: AuthUser | null,
    reason?: string,
  ): Promise<{ ok: true; daysAdded: number }> {
    const freeze = await this.repo.findOne({ where: { id: freezeId } });
    if (!freeze) throw new NotFoundException('Чөлөө олдсонгүй');
    if (freeze.endedAt) return { ok: true as const, daysAdded: 0 };
    if (freeze.scope !== FreezeScope.MEMBER || !freeze.memberId) {
      throw new BadRequestException('Баярын чөлөөг дуусгах шаардлагагүй');
    }

    const now = new Date();
    // Төлөвлөснөөс илүү нэмэхгүй: хэрэв ажил хожуу ажилласан бол
    // гишүүн нэмэлт хоног авах ёсгүй.
    const elapsed = Math.min(daysBetween(freeze.startsAt, now), freeze.days);

    freeze.endedAt = now;
    freeze.endedBy = user?.id ?? null;
    await this.repo.save(freeze);

    // Эхлээд эрхийг сэргээнэ — `suspended` хэвээр бол `recompute` нь
    // төлвийг хөндөхгүй бөгөөд гишүүн хаалттай хэвээр үлдэнэ.
    const member = await this.members.findOne({ where: { id: freeze.memberId } });
    if (member?.status === MemberStatus.SUSPENDED && user) {
      await this.memberships.resume(freeze.memberId, `Чөлөө дууслаа`, user);
    }

    const added = elapsed > 0 ? await this.apply(freeze, elapsed) : 0;
    if (user) {
      await this.audit.record({
        staffUserId: user.id,
        action: 'freeze.end',
        entity: 'member',
        entityId: freeze.memberId,
        after: { daysAdded: elapsed, planned: freeze.days, reason },
      });
    }
    this.log.log(`Чөлөө дууслаа: ${freeze.memberId} +${elapsed} хоног`);
    return { ok: true as const, daysAdded: added ? elapsed : 0 };
  }

  /**
   * Хугацаа нь дууссан чөлөөг өөрөө хаана.
   *
   * Өдөр бүр 00:30 — эрх дуусгах ажлаас (00:05) ХОЙНО: чөлөөний хоног
   * нэмэгдсэний дараа тэр гишүүн «хугацаа дууссан» гэж тэмдэглэгдэх
   * ёсгүй.
   */
  @Cron('30 0 * * *', { name: 'freeze-expire', timeZone: 'Asia/Ulaanbaatar' })
  async tick(): Promise<void> {
    const due = await this.repo.find({
      where: {
        scope: FreezeScope.MEMBER,
        endedAt: IsNull(),
        endsAt: LessThanOrEqual(new Date()),
      },
    });
    for (const f of due) {
      try {
        await this.autoEnd(f);
      } catch (e) {
        this.log.error(`Чөлөө дуусгаж чадсангүй ${f.id}: ${(e as Error).message}`);
      }
    }
    if (due.length) this.log.log(`Чөлөө дууслаа: ${due.length}`);
  }

  /** Систем өөрөө дуусгах — ажилтангүй тул `resume` шууд хийнэ. */
  private async autoEnd(freeze: Freeze): Promise<void> {
    const now = new Date();
    const elapsed = Math.min(daysBetween(freeze.startsAt, now), freeze.days);
    freeze.endedAt = now;
    await this.repo.save(freeze);

    if (freeze.memberId) {
      const member = await this.members.findOne({
        where: { id: freeze.memberId },
      });
      if (member?.status === MemberStatus.SUSPENDED) {
        member.status = MemberStatus.ACTIVE;
        await this.members.save(member);
      }
      if (elapsed > 0) await this.apply(freeze, elapsed);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  Жагсаалт
  // ══════════════════════════════════════════════════════════════

  /** Тухайн гишүүний ДУУСААГҮЙ чөлөө. */
  openOf(memberId: string): Promise<Freeze | null> {
    return this.repo.findOne({
      where: { memberId, scope: FreezeScope.MEMBER, endedAt: IsNull() },
    });
  }

  async ofMember(memberId: string): Promise<{
    open: Freeze | null;
    usedDays: number;
    limitPerYear: number;
    history: Freeze[];
  }> {
    return {
      open: await this.openOf(memberId),
      usedDays: await this.usedThisYear(memberId),
      limitPerYear: await this.settings.get('freeze_days_per_year'),
      history: await this.repo.find({
        where: { memberId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
    };
  }

  /** Сүүлийн чөлөөнүүд — админы дэлгэцэд. */
  recent(): Promise<Freeze[]> {
    return this.repo.find({ order: { createdAt: 'DESC' }, take: 50 });
  }

  // ══════════════════════════════════════════════════════════════

  /** Энэ жил хэдэн хоног авсан бэ — бодитоор олгосноор. */
  private async usedThisYear(memberId: string): Promise<number> {
    const from = new Date(new Date().getFullYear(), 0, 1);
    const rows = await this.apps
      .createQueryBuilder('a')
      .innerJoin(Freeze, 'f', 'f.id = a.freeze_id')
      .where('a.member_id = :memberId', { memberId })
      .andWhere('f.scope = :scope', { scope: FreezeScope.MEMBER })
      .andWhere('a.applied_at >= :from', { from })
      .select('coalesce(sum(a.days_added), 0)', 'total')
      .getRawOne<{ total: string }>();
    return Number(rows?.total ?? 0);
  }

  /**
   * Хоногийг олгоно — идемпотент.
   *
   * ⚠ `freeze_applications`-д НЭГ ГИШҮҮНД НЭГ л мөр байж болно. Давхар
   * оролдлогыг DB буцаана (`ON CONFLICT DO NOTHING`), тэр үед дэвтэрт
   * ч бичихгүй.
   */
  private async apply(freeze: Freeze, days: number): Promise<number> {
    const targets = freeze.memberId
      ? [freeze.memberId]
      : (
          await this.members.find({
            where: { status: MemberStatus.ACTIVE },
            select: { id: true },
          })
        ).map((m) => m.id);

    let applied = 0;
    for (const memberId of targets) {
      try {
        // ⚠ Бүртгэл ба дэвтрийн бичилт НЭГ гүйлгээнд. Тусад нь хийвэл
        // сунгалт унасан үед бүртгэл үлдэж, тэр гишүүн хоногоо ХЭЗЭЭ Ч
        // авахгүй болно — дахин оролдвол «аль хэдийн олгосон» гэж
        // алгасна. Ийм алдаа чимээгүй өнгөрдөг.
        await this.ds.transaction(async (m) => {
          const claim = await m
            .createQueryBuilder()
            .insert()
            .into(FreezeApplication)
            .values({ freezeId: freeze.id, memberId, daysAdded: days })
            .orIgnore() // ← давхар олголтыг DB зогсооно
            .execute();
          if (!claim.identifiers?.[0]?.id) return;

          const membership = await this.memberships.extend({
            memberId,
            days,
            amount: 0,
            source: MembershipSource.FREEZE,
            reason: `Чөлөө: ${freeze.reason}`,
            idempotencyKey: `freeze:${freeze.id}:${memberId}`,
          });
          await m.getRepository(FreezeApplication).update(
            { freezeId: freeze.id, memberId },
            { membershipId: membership.id },
          );
          applied++;
        });
      } catch (e) {
        // Нэг гишүүн унасан нь бусдыг зогсоох ёсгүй — 337 гишүүний
        // 336 нь хоногоо авах ёстой.
        this.log.error(
          `Чөлөө олгож чадсангүй ${memberId}: ${(e as Error).message}`,
        );
      }
    }
    return applied;
  }
}
