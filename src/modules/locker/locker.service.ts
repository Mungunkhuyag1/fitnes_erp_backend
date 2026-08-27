import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { pageResult, type PageResult } from '../../common/dto/paginated';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { endOfLocalDay } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import {
  LOYALTY_TOPICS,
  loyaltyGroup,
} from '../loyalty/loyalty-sync.service';
import { Member } from '../member/member.entity';
import { OutboxService } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import {
  LockerAssignment,
  LockerAssignmentType,
} from './locker-assignment.entity';
import { Locker } from './locker.entity';
import type {
  CreateLockerDto,
  IssueLockerDto,
  ListAssignmentsDto,
  ListLockersDto,
  ReturnLockerDto,
  UpdateLockerDto,
} from './dto/locker.dto';

@Injectable()
export class LockerService {
  private readonly log = new Logger(LockerService.name);

  constructor(
    @InjectRepository(Locker) private readonly lockers: Repository<Locker>,
    @InjectRepository(LockerAssignment)
    private readonly assignments: Repository<LockerAssignment>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  private static zoneKey(zone: string): string {
    return zone.trim();
  }

  // ══════════════════════════════════════════════════════════════
  //  Түлхүүр олгох
  // ══════════════════════════════════════════════════════════════

  async issue(dto: IssueLockerDto, user: AuthUser, ip?: string | null) {
    const zone = LockerService.zoneKey(dto.zone);
    const isRental = dto.type === LockerAssignmentType.RENTAL;

    if (isRental && (!dto.days || dto.days < 1)) {
      throw new BadRequestException('Түрээсийн хоногийг заана уу');
    }

    return this.ds.transaction(async (m) => {
      const member = await m.getRepository(Member).findOne({
        where: { id: dto.memberId },
      });
      if (!member) throw new NotFoundException('Гишүүн олдсонгүй');
      if (member.status === MemberStatus.CANCELLED) {
        throw new BadRequestException('Цуцлагдсан гишүүнд түлхүүр олгох боломжгүй');
      }

      // Шүүгээ байхгүй бол автоматаар үүсгэнэ — ресепшн зүгээр л дугаар бичнэ.
      const lockerRepo = m.getRepository(Locker);
      let locker = await lockerRepo.findOne({
        where: { zone, number: dto.number },
      });
      if (!locker) {
        locker = await lockerRepo.save(
          lockerRepo.create({ zone, number: dto.number }),
        );
        this.log.log(`Шүүгээ автоматаар үүслээ: ${zone} №${dto.number}`);
      }
      if (!locker.active) {
        throw new BadRequestException(
          `${zone} №${dto.number} шүүгээ түр хаалттай байна`,
        );
      }

      const asgRepo = m.getRepository(LockerAssignment);

      // ── Шүүгээ чөлөөтэй эсэх ──
      const busy = await asgRepo.findOne({
        where: { lockerId: locker.id, returnedAt: IsNull() },
      });
      if (busy) {
        const holder = await m
          .getRepository(Member)
          .findOne({ where: { id: busy.memberId } });
        throw new ConflictException(
          `${zone} №${dto.number} түлхүүр «${holder?.name ?? '?'}» ` +
            `(№${holder?.memberNo ?? '?'}) дээр байна`,
        );
      }

      // ── Гишүүнд аль хэдийн ижил төрлийн түлхүүр гарсан эсэх ──
      const held = await asgRepo.findOne({
        where: { memberId: member.id, type: dto.type, returnedAt: IsNull() },
      });
      if (held) {
        throw new ConflictException(
          `«${member.name}» дээр аль хэдийн ${held.lockerZone} ` +
            `№${held.lockerNumber} түлхүүр байна`,
        );
      }

      const now = new Date();
      const dueAt = isRental
        ? endOfLocalDay(new Date(now.getTime() + dto.days! * 86_400_000), this.tz)
        : null;

      const saved = await asgRepo.save(
        asgRepo.create({
          lockerId: locker.id,
          lockerZone: zone,
          lockerNumber: locker.number,
          memberId: member.id,
          type: dto.type,
          issuedAt: now,
          issuedBy: user.id,
          dueAt,
          amount: String(dto.amount ?? 0),
          source: isRental ? 'cash' : null,
          note: dto.note?.trim() || null,
        }),
      );

      // Түрээс нь мөнгөн гүйлгээ тул аудитад. Өдрийн түлхүүр нь өдөрт олон
      // удаа болдог урсгал үйлдэл — аудит бөглөхгүй, өөрийн бүртгэлтэй.
      if (isRental) {
        await this.audit.record(
          {
            staffUserId: user.id,
            action: 'locker.rent',
            entity: 'locker',
            entityId: `${zone}#${locker.number}`,
            after: {
              memberId: member.id,
              memberName: member.name,
              days: dto.days,
              amount: dto.amount ?? 0,
              dueAt,
            },
            reason: dto.note ?? null,
            ip,
          },
          m,
        );
      }

      return this.view(saved, member);
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  Түлхүүр буцааж авах
  // ══════════════════════════════════════════════════════════════

  async return(dto: ReturnLockerDto, user: AuthUser, ip?: string | null) {
    const zone = LockerService.zoneKey(dto.zone);

    return this.ds.transaction(async (m) => {
      const asgRepo = m.getRepository(LockerAssignment);
      const open = await asgRepo.findOne({
        where: { lockerZone: zone, lockerNumber: dto.number, returnedAt: IsNull() },
      });
      if (!open) {
        throw new NotFoundException(
          `${zone} №${dto.number} түлхүүр гарсан бүртгэл алга`,
        );
      }

      open.returnedAt = new Date();
      open.returnedBy = user.id;
      if (dto.note?.trim()) {
        open.note = [open.note, dto.note.trim()].filter(Boolean).join(' · ');
      }
      await asgRepo.save(open);

      const member = await m
        .getRepository(Member)
        .findOne({ where: { id: open.memberId } });

      const late =
        open.dueAt && open.returnedAt.getTime() > open.dueAt.getTime();
      if (open.type === LockerAssignmentType.RENTAL) {
        await this.audit.record(
          {
            staffUserId: user.id,
            action: 'locker.return',
            entity: 'locker',
            entityId: `${zone}#${dto.number}`,
            after: {
              memberName: member?.name,
              returnedAt: open.returnedAt,
              dueAt: open.dueAt,
              late: !!late,
            },
            ip,
          },
          m,
        );
      }

      return { ...this.view(open, member ?? null), late: !!late };
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  Самбар — ресепшний үндсэн дэлгэц
  // ══════════════════════════════════════════════════════════════

  /**
   * Өрөө тус бүрээр бүх шүүгээний ОДООГИЙН төлөв.
   *
   * Ресепшн «аль нь сул вэ», «№42 хэн дээр байна» гэдгийг нэг дэлгэцээс харна.
   */
  async board(zone?: string) {
    const where = zone ? { zone: LockerService.zoneKey(zone) } : {};
    const lockers = await this.lockers.find({
      where,
      order: { zone: 'ASC', number: 'ASC' },
    });
    const open = await this.assignments.find({
      where: { returnedAt: IsNull() },
    });
    const memberIds = [...new Set(open.map((a) => a.memberId))];
    const members = memberIds.length
      ? await this.members.find({
          where: { id: In(memberIds) },
          select: { id: true, name: true, memberNo: true },
        })
      : [];
    const memberMap = new Map(members.map((x) => [x.id, x]));
    const openMap = new Map(open.map((a) => [a.lockerId, a]));
    const now = Date.now();

    const zones = new Map<string, unknown[]>();
    for (const l of lockers) {
      const a = openMap.get(l.id);
      const holder = a ? memberMap.get(a.memberId) : undefined;
      const list = zones.get(l.zone) ?? [];
      list.push({
        id: l.id,
        number: l.number,
        active: l.active,
        status: !l.active
          ? 'disabled'
          : !a
            ? 'free'
            : a.type === LockerAssignmentType.RENTAL
              ? a.dueAt && a.dueAt.getTime() < now
                ? 'overdue'
                : 'rented'
              : 'daily',
        assignmentId: a?.id ?? null,
        memberId: a?.memberId ?? null,
        memberName: holder?.name ?? null,
        memberNo: holder?.memberNo ?? null,
        issuedAt: a?.issuedAt ?? null,
        dueAt: a?.dueAt ?? null,
        note: l.note,
      });
      zones.set(l.zone, list);
    }

    return {
      zones: [...zones.entries()].map(([name, items]) => ({
        zone: name,
        total: items.length,
        free: items.filter((i) => (i as { status: string }).status === 'free').length,
        items,
      })),
    };
  }

  /** Dashboard-ийн товч тоо. */
  async stats() {
    const [out, overdue] = await Promise.all([
      this.assignments.count({ where: { returnedAt: IsNull() } }),
      this.assignments
        .createQueryBuilder('a')
        .where('a.returned_at IS NULL')
        .andWhere('a.due_at IS NOT NULL')
        .andWhere('a.due_at < now()')
        .getCount(),
    ]);
    return { keysOut: out, overdueRentals: overdue };
  }

  // ══════════════════════════════════════════════════════════════
  //  Жагсаалтууд
  // ══════════════════════════════════════════════════════════════

  async listLockers(q: ListLockersDto): Promise<PageResult<unknown>> {
    const qb = this.lockers.createQueryBuilder('l');
    if (q.zone) qb.andWhere('l.zone = :z', { z: LockerService.zoneKey(q.zone) });
    if (q.active !== undefined) qb.andWhere('l.active = :a', { a: q.active });
    if (q.occupied !== undefined) {
      const sub = `EXISTS (SELECT 1 FROM locker_assignments x
                   WHERE x.locker_id = l.id AND x.returned_at IS NULL)`;
      qb.andWhere(q.occupied ? sub : `NOT ${sub}`);
    }
    qb.orderBy('l.zone', 'ASC').addOrderBy('l.number', 'ASC');
    const [rows, total] = await qb.skip(q.skip).take(q.take).getManyAndCount();
    return pageResult(rows, total, q);
  }

  /**
   * Түлхүүр буцаагаагүй гишүүнд ГАРААР Wallet сануулга илгээх.
   *
   * ЯАГААД ГАРААР ВЭ: «буцаагаагүй» гэдэг өгөгдөл нь гишүүн түлхүүрээ
   * аваад явсныг БАТАЛДАГГҮЙ — ресепшн буцаалтыг бүртгээгүй ч байж
   * болно (ялангуяа хаалтын цагт). Автоматаар илгээвэл түлхүүрээ
   * өгчихсөн хүн буруутгагдаж, мэдэгдлийн итгэл унана.
   *
   * Тиймээс ажилтан самбараа хараад, ҮНЭХЭЭР гишүүн дээр байгаа гэдгийг
   * мэдсэн үедээ дарна.
   */
  async remind(
    assignmentId: string,
    user: AuthUser,
  ): Promise<{ queued: boolean; reason?: string }> {
    const a = await this.assignments.findOne({ where: { id: assignmentId } });
    if (!a) throw new NotFoundException('Олголт олдсонгүй');
    if (a.returnedAt) {
      throw new BadRequestException('Түлхүүр аль хэдийн буцаагдсан');
    }

    const member = await this.members.findOne({ where: { id: a.memberId } });
    if (!member) throw new NotFoundException('Гишүүн олдсонгүй');
    if (!member.loopyCardSerial) {
      // Картгүй бол push хүрэх газар байхгүй — залгах хэрэгтэй.
      return { queued: false, reason: 'Гишүүн Wallet карттай биш — залгана уу' };
    }

    const where = `${a.lockerZone} №${a.lockerNumber}`;
    await this.outbox.enqueue({
      topic: LOYALTY_TOPICS.PUSH,
      payload: {
        memberId: member.id,
        message: `${where} шүүгээний түлхүүр буцаагдаагүй байна. Ресепшнд хүлээлгэн өгнө үү.`,
      },
      groupKey: loyaltyGroup(member.id),
    });

    await this.audit.record({
      staffUserId: user.id,
      action: 'locker.remind',
      entity: 'member',
      entityId: member.id,
      after: { locker: where, assignmentId: a.id, type: a.type },
    });
    return { queued: true };
  }

  async listAssignments(q: ListAssignmentsDto): Promise<PageResult<unknown>> {
    const qb = this.assignments.createQueryBuilder('a');
    if (q.memberId) qb.andWhere('a.member_id = :m', { m: q.memberId });
    if (q.q?.trim()) {
      // Гишүүний нэр/утсаар. ДЭД АСУУЛГААР — `leftJoin` + `addSelect` нь
      // `getManyAndCount()`-ыг эвдэж хуудаслалт буруу болгодог.
      const term = q.q.trim();
      const digits = term.replace(/\D/g, '');
      qb.andWhere(
        `a.member_id IN (
           SELECT id FROM members
           WHERE name ILIKE :like ${digits.length >= 2 ? 'OR phone LIKE :digits' : ''}
         )`,
        { like: `%${term}%`, digits: `%${digits}%` },
      );
    }
    if (q.zone) qb.andWhere('a.locker_zone = :z', { z: LockerService.zoneKey(q.zone) });
    if (q.type) qb.andWhere('a.type = :t', { t: q.type });
    if (q.outstanding !== undefined) {
      qb.andWhere(
        q.outstanding ? 'a.returned_at IS NULL' : 'a.returned_at IS NOT NULL',
      );
    }
    if (q.overdue) {
      qb.andWhere('a.returned_at IS NULL')
        .andWhere('a.due_at IS NOT NULL')
        .andWhere('a.due_at < now()');
    }
    qb.orderBy('a.issued_at', q.order ? q.direction : 'DESC');

    const [rows, total] = await qb.skip(q.skip).take(q.take).getManyAndCount();
    const ids = [...new Set(rows.map((r) => r.memberId))];
    const members = ids.length
      ? await this.members.find({
          where: { id: In(ids) },
          select: { id: true, name: true, memberNo: true },
        })
      : [];
    const map = new Map(members.map((x) => [x.id, x]));
    return pageResult(
      rows.map((r) => this.view(r, map.get(r.memberId) ?? null)),
      total,
      q,
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  Шүүгээний CRUD (заавал биш — олгоход автоматаар үүсдэг)
  // ══════════════════════════════════════════════════════════════

  async create(dto: CreateLockerDto): Promise<Locker> {
    const zone = LockerService.zoneKey(dto.zone);
    const exists = await this.lockers.findOne({
      where: { zone, number: dto.number },
    });
    if (exists) {
      throw new ConflictException(`${zone} №${dto.number} аль хэдийн бүртгэлтэй`);
    }
    return this.lockers.save(
      this.lockers.create({ zone, number: dto.number, note: dto.note?.trim() || null }),
    );
  }

  async update(id: string, dto: UpdateLockerDto): Promise<Locker> {
    const l = await this.lockers.findOne({ where: { id } });
    if (!l) throw new NotFoundException('Шүүгээ олдсонгүй');
    if (dto.note !== undefined) l.note = dto.note?.trim() || null;
    if (dto.active !== undefined) {
      if (!dto.active) {
        const busy = await this.assignments.findOne({
          where: { lockerId: id, returnedAt: IsNull() },
        });
        if (busy) {
          throw new BadRequestException(
            'Түлхүүр гарсан байхад шүүгээг хаах боломжгүй — эхлээд буцааж авна уу',
          );
        }
      }
      l.active = dto.active;
    }
    return this.lockers.save(l);
  }

  /** Гишүүнд сүүлд ямар өрөө ашигласныг санана — ресепшнд урьдчилан бөглөнө. */
  /**
   * Гишүүнд аль өрөөний шүүгээ санал болгохыг тодорхойлно.
   *
   * Хоёр эх сурвалж, дараалал нь чухал:
   *   1. СҮҮЛД ашигласан өрөө — бодит зан төлөв нь хамгийн найдвартай
   *      мэдээлэл. Хүйсээ «эрэгтэй» гэж бүртгүүлсэн ч ямар нэг шалтгаанаар
   *      өөр өрөө хэрэглэдэг бол түүнийг нь хүндэтгэнэ.
   *   2. ХҮЙС — анх удаа ирсэн хүнд түүх байхгүй тул үүнийг ашиглана.
   *      Өмнө нь бүх хүнд эхний өрөөг санал болгодог байсан нь хагас
   *      тохиолдолд буруу байв.
   *
   * Хоёулаа байхгүй бол `null` — ресепшн өөрөө сонгоно. Энэ нь ЗӨВЛӨМЖ л
   * болохоос хориглох дүрэм биш: ажилтан үргэлж өөрчилж чадна.
   */
  async suggestZoneFor(
    memberId: string,
  ): Promise<{ zone: string | null; source: 'history' | 'gender' | null }> {
    const last = await this.assignments.findOne({
      where: { memberId },
      order: { issuedAt: 'DESC' },
      select: { lockerZone: true },
    });
    if (last?.lockerZone) return { zone: last.lockerZone, source: 'history' };

    const member = await this.members.findOne({
      where: { id: memberId },
      select: { id: true, gender: true },
    });
    if (!member?.gender) return { zone: null, source: null };

    const map = await this.settings.get('locker_zone_by_gender');
    const zone = map[member.gender];
    // Тохиргоонд бичсэн өрөө үнэхээр байгаа эсэхийг шалгана — өрөөний нэрийг
    // сольсон бол байхгүй нэр санал болгож эргүүлэхгүй.
    if (!zone) return { zone: null, source: null };
    const exists = await this.lockers.exist({ where: { zone } });
    return exists ? { zone, source: 'gender' } : { zone: null, source: null };
  }

  private view(
    a: LockerAssignment,
    member: { id: string; name: string; memberNo: number } | null,
  ) {
    return {
      id: a.id,
      zone: a.lockerZone,
      number: a.lockerNumber,
      type: a.type,
      memberId: a.memberId,
      memberName: member?.name ?? null,
      memberNo: member?.memberNo ?? null,
      issuedAt: a.issuedAt,
      dueAt: a.dueAt,
      returnedAt: a.returnedAt,
      amount: Number(a.amount),
      overdue:
        !a.returnedAt && !!a.dueAt && a.dueAt.getTime() < Date.now(),
      note: a.note,
    };
  }
}
