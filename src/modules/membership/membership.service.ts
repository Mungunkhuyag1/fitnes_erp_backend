import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { pageResult, type PageResult } from '../../common/dto/paginated';
import {
  MembershipSource,
  MemberStatus,
} from '../../common/enums/member-status.enum';
import { Role } from '../../common/enums/role.enum';
import { computeNewEndsAt, endOfLocalDay } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { DEVICE_TOPICS, memberGroup } from '../device/device-sync.service';
import {
  LOYALTY_TOPICS,
  loyaltyGroup,
} from '../loyalty/loyalty-sync.service';
import { Member } from '../member/member.entity';
import { OutboxService } from '../outbox/outbox.service';
import { Package } from '../package/package.entity';
import { SettingsService } from '../settings/settings.service';
import {
  ExtendMembershipDto,
  ListMembershipsDto,
} from './dto/membership.dto';
import { Membership } from './membership.entity';

export interface ExtendInput {
  memberId: string;
  packageId?: string | null;
  days?: number;
  amount: number;
  source: MembershipSource;
  invoiceId?: string | null;
  staffUserId?: string | null;
  reason?: string | null;
  idempotencyKey: string;
  ip?: string | null;
}

@Injectable()
export class MembershipService {
  private readonly log = new Logger(MembershipService.name);

  constructor(
    @InjectRepository(Membership)
    private readonly repo: Repository<Membership>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(Package) private readonly packages: Repository<Package>,
    private readonly ds: DataSource,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  // ══════════════════════════════════════════════════════════════
  //  ЭРХ СУНГАХ — бүх төлбөрийн замын ГАНЦ гарц
  //  (Bonum, бэлэн, гараар — гурвуулаа энд ирнэ)
  // ══════════════════════════════════════════════════════════════

  async extend(input: ExtendInput): Promise<Membership> {
    // ── Идемпотент: сүлжээ тасарч дахин илгээгдсэн ч нэг л удаа ──
    const existing = await this.repo.findOne({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      this.log.log(`Сунгалт давхардлаа — өмнөх үр дүнг буцаав (${input.idempotencyKey})`);
      return existing;
    }

    // ── Хэдэн хоног, ямар багц ──
    let days = input.days ?? 0;
    let packageName: string | null = null;
    if (input.packageId) {
      const pkg = await this.packages.findOne({ where: { id: input.packageId } });
      if (!pkg) throw new NotFoundException('Багц олдсонгүй');
      if (!pkg.active) throw new BadRequestException('Багц идэвхгүй байна');
      days = pkg.days;
      packageName = pkg.name;
    }
    if (!days || days < 1) {
      throw new BadRequestException('Багц эсвэл хоногийн тоог заана уу');
    }

    return this.ds.transaction(async (m) => {
      // Мөрийг түгжинэ — хоёр ажилтан зэрэг сунгавал огноо алдагдахгүй.
      const member = await m
        .getRepository(Member)
        .findOne({ where: { id: input.memberId }, lock: { mode: 'pessimistic_write' } });
      if (!member) throw new NotFoundException('Гишүүн олдсонгүй');
      // ★ ЦУЦЛАГДСАН ГИШҮҮНИЙГ СЭРГЭЭХ
      //
      // Урьд нь энд алдаа шидэж «эхлээд дахин бүртгэнэ үү» гэдэг байв.
      // Гэвч дахин бүртгэх нь ШИНЭ гишүүний дугаар үүсгэх ба худалдан
      // авалтын түүх, ирцийн бүртгэл нь хуучин бүртгэл дээрээ үлдэнэ —
      // хоёр таслагдсан бичлэг үүснэ.
      //
      // Тиймээс төлбөр хийсэн цуцлагдсан гишүүнийг ТЭР ЧИГТ нь сэргээнэ.
      // Доор `revive` тугаар нэмэлт командуудыг дараална.
      const revive = member.status === MemberStatus.CANCELLED;

      const now = new Date();
      const before = {
        status: member.status,
        accessEndsAt: member.accessEndsAt,
      };

      // ★ Огноо тооцох ГАНЦ дүрэм — эрт төлсөн хоног алдагдахгүй.
      const endsAt = computeNewEndsAt(member.accessEndsAt, days, now, this.tz);
      const startsAt =
        member.accessEndsAt && member.accessEndsAt > now
          ? member.accessEndsAt
          : now;

      const saved = await m.getRepository(Membership).save(
        m.getRepository(Membership).create({
          memberId: member.id,
          packageId: input.packageId ?? null,
          packageName,
          days,
          amount: String(input.amount),
          source: input.source,
          invoiceId: input.invoiceId ?? null,
          staffUserId: input.staffUserId ?? null,
          reason: input.reason ?? null,
          startsAt,
          endsAt,
          idempotencyKey: input.idempotencyKey,
        }),
      );

      member.accessEndsAt = endsAt;
      // Зогсоосон гишүүн төлбөр хийвэл автоматаар сэргэхгүй — ажилтан
      // зориудаар «сэргээх» үйлдэл хийнэ.
      if (member.status !== MemberStatus.SUSPENDED) {
        member.status = MemberStatus.ACTIVE;
      }
      if (revive) {
        // Цуцлах үед терминалаас хэрэглэгчийг УСТГАСАН — царай нь хамт
        // устсан. Тиймээс дахин уншуулах шаардлагатай гэж тэмдэглэнэ,
        // эс бөгөөс «царай бүртгэлтэй» мөртлөө терминал танихгүй байна.
        member.faceEnrolled = false;
        member.faceEnrolledAt = null;
      }
      await m.getRepository(Member).save(member);

      await this.pushToDevice(member.id, m);
      await this.pushToLoyalty(member.id, m, [
        LOYALTY_TOPICS.EXTEND,
        LOYALTY_TOPICS.FIELDS,
      ]);

      if (revive) {
        // Цуцлахад буцаагдсан зүйлсийг сэргээнэ:
        //   • Loopy жагсаалтаас хасагдсан  → дахин нэмнэ
        //   • Карт `revoked` болсон        → `active` руу буцаана
        // Терминал дээрх хэрэглэгчийг `setValidity` өөрөө сэргээнэ:
        // хэрэглэгч байхгүй бол `MissingDeviceUserError` шидэгдэж,
        // бүтэн `upsertUser` хийгддэг (device-sync.service §self-heal).
        await this.pushToLoyalty(member.id, m, [
          LOYALTY_TOPICS.ALLOW_PHONE,
          LOYALTY_TOPICS.STATUS,
        ]);
        await this.audit.record(
          {
            staffUserId: input.staffUserId ?? null,
            action: 'member.revive',
            entity: 'member',
            entityId: member.id,
            before: { status: MemberStatus.CANCELLED },
            after: { status: member.status },
            reason: 'Төлбөр хийж эрхээ сунгасан тул автоматаар сэргэв',
            ip: input.ip ?? null,
          },
          m,
        );
        this.log.warn(
          `Цуцлагдсан гишүүн СЭРГЭВ: №${member.memberNo} ${member.name} — ` +
            'царайгаа дахин уншуулах шаардлагатай',
        );
      }

      if (input.source !== MembershipSource.BONUM) {
        await this.audit.record(
          {
            staffUserId: input.staffUserId ?? null,
            action: 'membership.extend',
            entity: 'member',
            entityId: member.id,
            before,
            after: { status: member.status, accessEndsAt: endsAt, days, amount: input.amount },
            reason: input.reason ?? null,
            ip: input.ip ?? null,
          },
          m,
        );
      }

      this.log.log(
        `Эрх сунгав: №${member.memberNo} ${member.name} +${days} хоног → ${endsAt.toISOString()} (${input.source})`,
      );
      return saved;
    });
  }

  /** Ажилтны гараас ирсэн хүсэлт — эрхийн шалгалттай. */
  async extendByStaff(
    memberId: string,
    dto: ExtendMembershipDto,
    user: AuthUser,
    ip?: string | null,
  ): Promise<Membership> {
    if (dto.method === MembershipSource.BONUM) {
      throw new BadRequestException(
        'Онлайн төлбөрийг гараар бүртгэх боломжгүй — нэхэмжлэх үүсгэнэ үү',
      );
    }
    if (!dto.packageId && !dto.days) {
      throw new BadRequestException('Багц эсвэл хоногийн тоог заана уу');
    }
    // Багцгүй, дурын хоногоор сунгах нь тайлбаргүй байж болохгүй.
    if ((!dto.packageId || dto.method === MembershipSource.MANUAL) && !dto.reason?.trim()) {
      throw new BadRequestException('Тайлбар (`reason`) заавал шаардлагатай');
    }
    if (user.role === Role.RECEPTION) {
      const allowed = await this.settings.get('allow_reception_extend');
      if (!allowed) {
        throw new ForbiddenException(
          'Ресепшн эрх сунгах боломжгүй — менежерт хандана уу',
        );
      }
    }

    return this.extend({
      memberId,
      packageId: dto.packageId,
      days: dto.days,
      amount: dto.amount,
      source: dto.method,
      staffUserId: user.id,
      reason: dto.reason ?? null,
      idempotencyKey: dto.idempotencyKey,
      ip,
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  Буцаалт
  // ══════════════════════════════════════════════════════════════

  async reverse(
    membershipId: string,
    reason: string,
    user: AuthUser,
    ip?: string | null,
  ): Promise<{ ok: true; accessEndsAt: Date | null }> {
    return this.ds.transaction(async (m) => {
      const row = await m
        .getRepository(Membership)
        .findOne({ where: { id: membershipId } });
      if (!row) throw new NotFoundException('Гишүүнчлэл олдсонгүй');
      if (row.reversedAt) {
        throw new BadRequestException('Аль хэдийн буцаагдсан байна');
      }

      // Мөрийг УСТГАХГҮЙ — тэмдэглэгээ тавиад эрхийг дэвтрээс дахин тооцно.
      row.reversedAt = new Date();
      row.reversedBy = user.id;
      row.reverseReason = reason;
      await m.getRepository(Membership).save(row);

      const endsAt = await this.recompute(row.memberId, m);
      await this.pushToDevice(row.memberId, m);
      await this.pushToLoyalty(row.memberId, m, [LOYALTY_TOPICS.EXTEND]);

      await this.audit.record(
        {
          staffUserId: user.id,
          action: 'membership.reverse',
          entity: 'membership',
          entityId: row.id,
          before: { days: row.days, amount: row.amount, endsAt: row.endsAt },
          after: { accessEndsAt: endsAt },
          reason,
          ip,
        },
        m,
      );
      return { ok: true as const, accessEndsAt: endsAt };
    });
  }

  /**
   * ★ Эрхийн огноог ДЭВТРЭЭС дахин тооцох.
   *
   * Худалдан авалтуудыг он дарааллаар нь давтан «тоглуулж» эцсийн огноог
   * гаргана. Буцаагдсан мөрийг алгасна.
   *
   * Энэ функц нь буцаалтад ба шөнийн тулгалтад ижилхэн хэрэглэгдэнэ —
   * `access_ends_at` кэш зөрвөл ҮРГЭЛЖ дэвтэр зөв (docs/02 §5.4).
   */
  async recompute(memberId: string, manager?: EntityManager): Promise<Date | null> {
    const m = manager ?? this.ds.manager;
    const rows = await m.getRepository(Membership).find({
      where: { memberId, reversedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });

    let ends: Date | null = null;
    for (const r of rows) {
      const base = ends && ends > r.createdAt ? ends : r.createdAt;
      ends = endOfLocalDay(
        new Date(base.getTime() + r.days * 86_400_000),
        this.tz,
      );
    }

    const member = await m.getRepository(Member).findOne({ where: { id: memberId } });
    if (!member) return ends;

    member.accessEndsAt = ends;
    if (
      member.status !== MemberStatus.SUSPENDED &&
      member.status !== MemberStatus.CANCELLED
    ) {
      member.status =
        ends && ends.getTime() > Date.now()
          ? MemberStatus.ACTIVE
          : rows.length
            ? MemberStatus.EXPIRED
            : MemberStatus.LEAD;
    }
    await m.getRepository(Member).save(member);
    return ends;
  }

  // ══════════════════════════════════════════════════════════════
  //  Төлөв өөрчлөх
  // ══════════════════════════════════════════════════════════════

  async suspend(memberId: string, reason: string, user: AuthUser, ip?: string | null) {
    return this.changeStatus(memberId, MemberStatus.SUSPENDED, reason, user, ip);
  }

  async resume(memberId: string, reason: string, user: AuthUser, ip?: string | null) {
    return this.ds.transaction(async (m) => {
      const member = await this.lock(memberId, m);
      if (member.status !== MemberStatus.SUSPENDED) {
        throw new BadRequestException('Зөвхөн зогссон гишүүнийг сэргээнэ');
      }
      const before = { status: member.status };
      // Хугацаа нь өнгөрсөн бол `expired` болно — `recompute` шийднэ.
      member.status = MemberStatus.ACTIVE;
      await m.getRepository(Member).save(member);
      await this.recompute(memberId, m);
      await this.pushToDevice(memberId, m);
      await this.pushToLoyalty(memberId, m, [
        LOYALTY_TOPICS.STATUS,
        LOYALTY_TOPICS.EXTEND,
      ]);
      await this.audit.record(
        { staffUserId: user.id, action: 'member.resume', entity: 'member',
          entityId: memberId, before, after: { status: 'active' }, reason, ip },
        m,
      );
      return { ok: true as const };
    });
  }

  async cancel(memberId: string, reason: string, user: AuthUser, ip?: string | null) {
    return this.ds.transaction(async (m) => {
      const member = await this.lock(memberId, m);
      const before = { status: member.status, accessEndsAt: member.accessEndsAt };
      member.status = MemberStatus.CANCELLED;
      await m.getRepository(Member).save(member);

      // Цуцлах үед ЗӨВХӨН энд төхөөрөмжөөс устгана — царай нь хамт устана.
      await this.outbox.enqueue(
        {
          topic: DEVICE_TOPICS.USER_DELETE,
          payload: { memberId },
          groupKey: memberGroup(memberId),
        },
        m,
      );
      // Цуцлагдсан гишүүний картыг хүчингүй болгож, allowlist-аас хасна —
      // эс тэгвээс дахин карт авах боломжтой хэвээр үлдэнэ.
      await this.outbox.enqueue(
        [
          {
            topic: LOYALTY_TOPICS.STATUS,
            payload: { memberId },
            groupKey: loyaltyGroup(memberId),
          },
          {
            topic: LOYALTY_TOPICS.DISALLOW_PHONE,
            payload: { phone: member.phone },
            groupKey: loyaltyGroup(memberId),
          },
        ],
        m,
      );
      await this.audit.record(
        { staffUserId: user.id, action: 'member.cancel', entity: 'member',
          entityId: memberId, before, after: { status: 'cancelled' }, reason, ip },
        m,
      );
      return { ok: true as const };
    });
  }

  private async changeStatus(
    memberId: string,
    status: MemberStatus,
    reason: string,
    user: AuthUser,
    ip?: string | null,
  ) {
    return this.ds.transaction(async (m) => {
      const member = await this.lock(memberId, m);
      if (member.status === status) {
        throw new BadRequestException('Гишүүн аль хэдийн энэ төлөвт байна');
      }
      const before = { status: member.status };
      member.status = status;
      await m.getRepository(Member).save(member);
      await this.pushToDevice(memberId, m);
      await this.pushToLoyalty(memberId, m, [LOYALTY_TOPICS.STATUS]);
      await this.audit.record(
        { staffUserId: user.id, action: 'member.suspend', entity: 'member',
          entityId: memberId, before, after: { status }, reason, ip },
        m,
      );
      return { ok: true as const };
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  Жагсаалт
  // ══════════════════════════════════════════════════════════════

  async list(q: ListMembershipsDto): Promise<PageResult<unknown>> {
    // Гишүүний нэрийг ТУСДАА татна. `leftJoin(Member, …) + addSelect` нь
    // relation биш тул `getManyAndCount()`-ыг эвддэг.
    const qb = this.repo.createQueryBuilder('ms');
    if (q.memberId) qb.andWhere('ms.member_id = :mid', { mid: q.memberId });
    if (q.source) qb.andWhere('ms.source = :src', { src: q.source });
    if (q.from) qb.andWhere('ms.created_at >= :from', { from: q.from });
    if (q.to) qb.andWhere('ms.created_at <= :to', { to: q.to });
    qb.orderBy('ms.created_at', q.order ? q.direction : 'DESC');

    const [rows, total] = await qb.skip(q.skip).take(q.take).getManyAndCount();
    const memberMap = await this.memberNames(rows.map((r) => r.memberId));
    return pageResult(
      rows.map((r) => ({
        id: r.id,
        memberId: r.memberId,
        memberName: memberMap.get(r.memberId)?.name ?? null,
        memberNo: memberMap.get(r.memberId)?.memberNo ?? null,
        packageName: r.packageName,
        days: r.days,
        amount: Number(r.amount),
        source: r.source,
        reason: r.reason,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        reversedAt: r.reversedAt,
        createdAt: r.createdAt,
      })),
      total,
      q,
    );
  }

  // ── Дотоод ──

  private async memberNames(ids: string[]) {
    if (!ids.length) return new Map<string, { name: string; memberNo: number }>();
    const rows = await this.members.find({
      where: { id: In(ids) },
      select: { id: true, name: true, memberNo: true },
    });
    return new Map(rows.map((r) => [r.id, { name: r.name, memberNo: r.memberNo }]));
  }

  private async lock(memberId: string, m: EntityManager): Promise<Member> {
    const member = await m
      .getRepository(Member)
      .findOne({ where: { id: memberId }, lock: { mode: 'pessimistic_write' } });
    if (!member) throw new NotFoundException('Гишүүн олдсонгүй');
    return member;
  }

  /**
   * Loopy карт руу даалгавар.
   *
   * Гишүүн карт үүсгээгүй бол handler нь чимээгүй алгасна — карт бол зөвхөн
   * харуулах давхарга (шийдвэр 3), картгүй гишүүн байх нь ХЭВИЙН.
   */
  private pushToLoyalty(
    memberId: string,
    m: EntityManager,
    topics: string[],
  ): Promise<void> {
    return this.outbox.enqueue(
      topics.map((topic) => ({
        topic,
        payload: { memberId },
        groupKey: loyaltyGroup(memberId),
      })),
      m,
    );
  }

  /** Терминал руу «одоогийн төлөвөө бич» даалгавар (идемпотент). */
  private pushToDevice(memberId: string, m: EntityManager): Promise<void> {
    return this.outbox.enqueue(
      {
        topic: DEVICE_TOPICS.SET_VALIDITY,
        payload: { memberId },
        groupKey: memberGroup(memberId),
      },
      m,
    );
  }
}
