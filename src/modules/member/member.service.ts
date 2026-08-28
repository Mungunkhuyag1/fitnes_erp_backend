import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, Not, Repository } from 'typeorm';
import { pageResult, type PageResult } from '../../common/dto/paginated';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { daysBetween } from '../../common/utils/date.util';
import { isValidPhone, normalizePhone } from '../../common/utils/phone.util';

/**
 * Яаралтай үед холбоо барих дугаарыг ЗӨӨЛӨН цэгцэлнэ.
 *
 * Энэ дугаар нь ихэвчлэн гэр бүлийн гишүүнийх — гадаадын дугаар, дотуур
 * дугаар ч байж болно. Тиймээс 8 оронтой МУ-ын дугаар бол хэвийн хэлбэрт
 * шилжүүлж, бусад тохиолдолд бичсэн хэлбэрээр нь хадгална. Гишүүний өөрийн
 * дугаараас ялгаатай нь — үүгээр хэзээ ч хайдаггүй, зөвхөн залгадаг.
 */
/**
 * Төрсөн огноо УТГА УЧИРТАЙ эсэхийг шалгана.
 *
 * DTO нь зөвхөн хэлбэрийг (YYYY-MM-DD) шалгадаг тул `2099-01-01` эсвэл
 * `1800-05-05` ч нэвтэрч орно. Ийм утга насны тайланг сүйтгэнэ.
 * Хилийг сулхан тавив — 120 нас хүртэл, ирээдүй рүү нэг ч өдөр биш.
 */
function assertBirthDate(v: string, tz: string): void {
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || v !== d.toISOString().slice(0, 10)) {
    throw new BadRequestException('Төрсөн огноо буруу байна');
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (v > today) {
    throw new BadRequestException('Төрсөн огноо ирээдүйд байж болохгүй');
  }
  if (Number(v.slice(0, 4)) < Number(today.slice(0, 4)) - 120) {
    throw new BadRequestException('Төрсөн огноо хэт эрт байна');
  }
}

/**
 * Гишүүний Wallet картын явцыг тодорхойлно.
 *
 * Дараалал нь ЧУХАЛ — эхний тохирсон нь ялна, учир нь өмнөх алхам
 * гүйцээгүй бол дараагийнх утгагүй:
 *
 *   1. Loopy-д бүртгэгдээгүй → гишүүн карт үүсгэх БОЛОМЖГҮЙ. Системийн
 *      алдаа тул хамгийн түрүүнд харагдана.
 *   2. Карт үүсгээгүй → гишүүнд enroll линк илгээх ёстой.
 *   3. Wallet-д нэмээгүй → карт бий ч push ХҮРЭХГҮЙ, залгах ёстой.
 *
 * `walletDevices === null` нь «хараахан шалгаагүй» — үүнийг «нэмээгүй» гэж
 * үзвэл шинэ карт бүр буруугаар улаан болно. Тиймээс идэвхтэй гэж үзнэ.
 */
function stageOf(m: Member): CardStage {
  // Цуцлагдсан гишүүнийг тусгайлан шалгахгүй: тэдний `loopyAllowedAt` нь
  // цуцлах үедээ цэвэрлэгддэг тул ямар ч байсан `NOT_ALLOWED` гарна. Энэ нь
  // алдаа биш — зориудын үр дүн. Дэлгэц дээр цуцлагдсан гишүүнийг
  // «засвар шаардлагатай» гэж тодруулахгүй.
  if (!m.loopyAllowedAt) return CardStage.NOT_ALLOWED;
  if (!m.loopyCardSerial) return CardStage.NO_CARD;
  if (m.walletDevices === 0) return CardStage.NO_WALLET;
  return CardStage.ACTIVE;
}

function softPhone(raw?: string | null): string | null {
  const v = raw?.trim();
  if (!v) return null;
  return isValidPhone(v) ? normalizePhone(v) : v;
}
import {
  DEVICE_TOPICS,
  memberGroup,
} from '../device/device-sync.service';
import {
  LOYALTY_TOPICS,
  loyaltyGroup,
} from '../loyalty/loyalty-sync.service';
import { OutboxService } from '../outbox/outbox.service';
import { CreateMemberDto, ListMembersDto, UpdateMemberDto } from './dto/member.dto';
import { Member } from './member.entity';
import { CardStage } from '../../common/enums/card-stage.enum';
import { Gender } from '../../common/enums/gender.enum';

/**
 * Төрсөн огноогоор насыг тооцно.
 *
 * Улаанбаатарын ӨНӨӨДРИЙН огноог сууриа болгоно — сервер UTC дээр
 * ажиллаж байхад «өнөөдөр» гэдэг нь хэрэглэгчийнхээс өөр өдөр байж
 * болзошгүй тул. Төрсөн өдөр нь энэ жил хараахан болоогүй бол нэгийг хасна.
 */
function ageFrom(birth: string | null, tz: string): number | null {
  if (!birth) return null;
  const [by, bm, bd] = birth.split('-').map(Number);
  if (!by || !bm || !bd) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [ty, tm, td] = parts.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export interface MemberRow {
  id: string;
  memberNo: number;
  name: string;
  phone: string | null;
  status: MemberStatus;
  accessEndsAt: Date | null;
  daysLeft: number | null;
  faceEnrolled: boolean;
  hasCard: boolean;
  /** Wallet картын явц — «карт байна/байхгүй»-гээс илүү нарийн (§08). */
  cardStage: CardStage;
  lastVisitAt: Date | null;
  syncError: string | null;
}

export interface MemberDetail extends MemberRow {
  email: string | null;
  note: string | null;
  gender: Gender | null;
  birthDate: string | null;
  age: number | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  faceEnrolledAt: Date | null;
  hikSyncedAt: Date | null;
  loopyCardSerial: string | null;
  /** Wallet-д нэмсэн төхөөрөмжийн тоо. `null` = хараахан шалгаагүй. */
  walletDevices: number | null;
  payToken: string;
  createdAt: Date;
  updatedAt: Date;
}

const SORT_COLUMNS: Record<string, string> = {
  name: 'm.name',
  endsAt: 'm.access_ends_at',
  createdAt: 'm.created_at',
  memberNo: 'm.member_no',
  lastVisit: 'm.last_visit_at',
};

@Injectable()
export class MemberService {
  private readonly log = new Logger(MemberService.name);

  constructor(
    @InjectRepository(Member) private readonly repo: Repository<Member>,
    private readonly ds: DataSource,
    private readonly config: ConfigService,
    private readonly outbox: OutboxService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  /**
   * БҮХ гишүүнийг терминал болон Loopy руу дахин бичихээр дараалалд оруулна.
   *
   * Хэзээ хэрэглэх вэ:
   *   • Терминалыг сольсон / factory reset хийсэн — хэн ч бүртгэлгүй үлдсэн
   *   • Loopy программыг сольсон
   *   • Урт хугацааны тасалдлын дараа бүрэн эсэхийг батлах
   *
   * ХҮНД ажил: гишүүн бүрд 2 мөр үүснэ. 60 гишүүнд 120 мөр — Loopy-гийн
   * 60/мин хязгаараар ~2 минут. Тиймээс дэлгэц дээр баталгаажуулна.
   *
   * Цуцлагдсан гишүүнийг ОРУУЛАХГҮЙ — тэднийг терминалаас зориуд хассан.
   */
  async resyncAll(): Promise<{ members: number; queued: number }> {
    const members = await this.repo.find({
      where: { status: Not(MemberStatus.CANCELLED) },
      select: { id: true },
    });
    if (!members.length) return { members: 0, queued: 0 };

    await this.ds.transaction(async (tx) => {
      await this.outbox.enqueue(
        members.flatMap((m) => [
          {
            topic: DEVICE_TOPICS.USER_UPSERT,
            payload: { memberId: m.id },
            groupKey: memberGroup(m.id),
          },
          {
            topic: LOYALTY_TOPICS.ALLOW_PHONE,
            payload: { memberId: m.id },
            groupKey: loyaltyGroup(m.id),
          },
        ]),
        tx,
      );
    });
    this.log.warn(`Бүрэн sync: ${members.length} гишүүн дараалалд оров`);
    return { members: members.length, queued: members.length * 2 };
  }

  // ── Жагсаалт ──

  async list(q: ListMembersDto): Promise<PageResult<MemberRow>> {
    const qb = this.repo.createQueryBuilder('m');

    if (q.noPhone) qb.andWhere('m.phone IS NULL');
    if (q.q?.trim()) {
      const term = q.q.trim();
      // Утсаар хайхад нормчилсон хэлбэрээр — «+976 9911» гэж бичсэн ч олдоно.
      let digits = term.replace(/\D/g, '');
      if (digits.length > 8 && digits.startsWith('00976')) digits = digits.slice(5);
      if (digits.length > 8 && digits.startsWith('976')) digits = digits.slice(3);
      qb.andWhere(
        digits.length >= 2
          ? '(m.name ILIKE :like OR m.phone LIKE :digits)'
          : 'm.name ILIKE :like',
        { like: `%${term}%`, digits: `%${digits}%` },
      );
    }

    if (q.status) qb.andWhere('m.status = :status', { status: q.status });
    if (q.gender) qb.andWhere('m.gender = :gender', { gender: q.gender });

    // Явцын шүүлтүүр — SQL дээр шууд, `stageOf`-той ЯГ ижил дараалалтай.
    // (Санд шүүхгүй бол хуудаслалт буруу болно.)
    if (q.cardStage === CardStage.NOT_ALLOWED) {
      qb.andWhere('m.loopy_allowed_at IS NULL');
    } else if (q.cardStage === CardStage.NO_CARD) {
      qb.andWhere('m.loopy_allowed_at IS NOT NULL').andWhere(
        'm.loopy_card_serial IS NULL',
      );
    } else if (q.cardStage === CardStage.NO_WALLET) {
      qb.andWhere('m.loopy_allowed_at IS NOT NULL')
        .andWhere('m.loopy_card_serial IS NOT NULL')
        .andWhere('m.wallet_devices = 0');
    } else if (q.cardStage === CardStage.ACTIVE) {
      qb.andWhere('m.loopy_allowed_at IS NOT NULL')
        .andWhere('m.loopy_card_serial IS NOT NULL')
        .andWhere('(m.wallet_devices IS NULL OR m.wallet_devices > 0)');
    }

    if (q.expiring !== undefined) {
      // «Удахгүй дуусах» — зөвхөн идэвхтэй эрхтэй хүн утга учиртай.
      const until = new Date(Date.now() + q.expiring * 86_400_000);
      qb.andWhere('m.status = :active', { active: MemberStatus.ACTIVE })
        .andWhere('m.access_ends_at IS NOT NULL')
        .andWhere('m.access_ends_at <= :until', { until });
    }

    if (q.faceEnrolled !== undefined) {
      qb.andWhere('m.face_enrolled = :fe', { fe: q.faceEnrolled });
    }
    if (q.hasCard !== undefined) {
      qb.andWhere(
        q.hasCard
          ? 'm.loopy_card_serial IS NOT NULL'
          : 'm.loopy_card_serial IS NULL',
      );
    }
    if (q.syncError !== undefined) {
      qb.andWhere(
        q.syncError ? 'm.hik_sync_error IS NOT NULL' : 'm.hik_sync_error IS NULL',
      );
    }

    const column = SORT_COLUMNS[q.sort ?? 'createdAt'] ?? 'm.created_at';
    // «Удахгүй дуусах» жагсаалтад эрт дуусах нь эхэнд байх нь зөв.
    const dir = q.order ? q.direction : q.expiring !== undefined ? 'ASC' : 'DESC';
    qb.orderBy(column, dir).addOrderBy('m.id', 'ASC'); // тогтвортой дараалал

    const [rows, total] = await qb.skip(q.skip).take(q.take).getManyAndCount();
    return pageResult(rows.map((r) => this.row(r)), total, q);
  }

  // ── Нэг гишүүн ──

  async detail(id: string): Promise<MemberDetail> {
    const m = await this.find(id);
    return {
      ...this.row(m),
      email: m.email,
      note: m.note,
      gender: m.gender,
      birthDate: m.birthDate,
      age: ageFrom(m.birthDate, this.tz),
      emergencyName: m.emergencyName,
      emergencyPhone: m.emergencyPhone,
      faceEnrolledAt: m.faceEnrolledAt,
      hikSyncedAt: m.hikSyncedAt,
      loopyCardSerial: m.loopyCardSerial,
      walletDevices: m.walletDevices,
      payToken: m.payToken,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }

  // ── Үүсгэх ──

  async create(dto: CreateMemberDto): Promise<MemberDetail> {
    const phone = this.requirePhone(dto.phone);
    await this.assertPhoneFree(phone);

    // `member_no` дарааллаас — устгасан дугаар ДАХИН олгогдохгүй.
    const memberNo = await this.nextMemberNo();

    // Гишүүн ба «терминал руу бич» даалгавар НЭГ транзакцад — аль нэг нь
    // дутуу үлдэх боломжгүй (docs/02 §6).
    if (dto.birthDate) assertBirthDate(dto.birthDate, this.tz);
    const saved = await this.ds.transaction(async (m) => {
      const row = await m.getRepository(Member).save(
        m.getRepository(Member).create({
          memberNo,
          name: dto.name.trim(),
          phone,
          email: dto.email?.trim().toLowerCase() || null,
          note: dto.note?.trim() || null,
          gender: dto.gender ?? null,
          birthDate: dto.birthDate ?? null,
          emergencyName: dto.emergencyName?.trim() || null,
          emergencyPhone: softPhone(dto.emergencyPhone),
          status: MemberStatus.LEAD,
          payToken: randomBytes(24).toString('base64url'),
        }),
      );
      await this.outbox.enqueue(
        [
          {
            topic: DEVICE_TOPICS.USER_UPSERT,
            payload: { memberId: row.id },
            groupKey: memberGroup(row.id),
          },
          // Loopy allowlist — зөвхөн фитнест бүртгэлтэй хүн карт үүсгэнэ
          // (docs/01-integration-model.md §6.1).
          {
            topic: LOYALTY_TOPICS.ALLOW_PHONE,
            payload: { memberId: row.id },
            groupKey: loyaltyGroup(row.id),
          },
        ],
        m,
      );
      return row;
    });
    return this.detail(saved.id);
  }

  // ── Засах ──

  async update(id: string, dto: UpdateMemberDto): Promise<MemberDetail> {
    const m = await this.find(id);
    // `from` нь NULL байж болно: терминалаас импортлосон утасгүй
    // гишүүнд ажилтан анх удаа дугаар оруулах тохиолдол.
    let phoneChanged: { from: string | null; to: string } | null = null;

    if (dto.phone !== undefined) {
      const phone = this.requirePhone(dto.phone);
      if (phone !== m.phone) {
        await this.assertPhoneFree(phone, id);
        const oldPhone = m.phone;
        m.phone = phone;
        // Утас солигдоход Loopy allowlist-ыг ЗӨВ байлгана: хуучныг хасаж,
        // шинийг нэмнэ. Эс тэгвээс хуучин дугаараар карт авах боломж үлдэнэ.
        phoneChanged = { from: oldPhone, to: phone };
      }
    }
    const nameChanged = dto.name !== undefined && dto.name.trim() !== m.name;
    if (dto.name !== undefined) m.name = dto.name.trim();
    if (dto.email !== undefined) m.email = dto.email?.trim().toLowerCase() || null;
    if (dto.note !== undefined) m.note = dto.note?.trim() || null;
    // Нэмэлт талбарууд — терминал ч, Loopy ч эдгээрийг хэрэглэдэггүй тул
    // өөрчлөгдөхөд ямар ч sync хийхгүй.
    if (dto.gender !== undefined) m.gender = dto.gender ?? null;
    if (dto.birthDate !== undefined) {
      if (dto.birthDate) assertBirthDate(dto.birthDate, this.tz);
      m.birthDate = dto.birthDate || null;
    }
    if (dto.emergencyName !== undefined) m.emergencyName = dto.emergencyName?.trim() || null;
    if (dto.emergencyPhone !== undefined)
      m.emergencyPhone = softPhone(dto.emergencyPhone);

    await this.ds.transaction(async (tx) => {
      await tx.getRepository(Member).save(m);
      // Терминал дээр гарч байдаг цорын ганц талбар нь НЭР — зөвхөн тэр
      // өөрчлөгдсөн үед дахин бичнэ (и-мэйл/тэмдэглэл терминалд хамаагүй).
      if (nameChanged) {
        await this.outbox.enqueue(
          {
            topic: DEVICE_TOPICS.USER_UPSERT,
            payload: { memberId: m.id },
            groupKey: memberGroup(m.id),
          },
          tx,
        );
      }
      if (phoneChanged) {
        await this.outbox.enqueue(
          [
            // Хуучин дугаар БАЙСАН бол л Loopy-гоос хасна. Утасгүй
            // гишүүнд анх удаа оруулахад хасах зүйл байхгүй.
            ...(phoneChanged.from
              ? [
                  {
                    topic: LOYALTY_TOPICS.DISALLOW_PHONE,
                    payload: { phone: phoneChanged.from },
                    groupKey: loyaltyGroup(m.id),
                  },
                ]
              : []),
            {
              topic: LOYALTY_TOPICS.ALLOW_PHONE,
              payload: { memberId: m.id },
              groupKey: loyaltyGroup(m.id),
            },
          ],
          tx,
        );
      }
    });
    return this.detail(id);
  }

  /**
   * Терминал руу дахин бичих.
   *
   * Синк алдаа гарсны дараа ажилтан гараар дарна. Idempotent тул хэдэн ч
   * удаа дарж болно — handler нь одоогийн төлөвийг л бичдэг.
   */
  async resync(id: string): Promise<{ ok: true }> {
    const m = await this.find(id);
    await this.ds.transaction(async (tx) => {
      await tx.getRepository(Member).update(m.id, { hikSyncError: null });
      await this.outbox.enqueue(
        {
          topic: DEVICE_TOPICS.USER_UPSERT,
          payload: { memberId: m.id },
          groupKey: memberGroup(m.id),
        },
        tx,
      );
    });
    return { ok: true as const };
  }

  /** Төлбөрийн холбоосыг сэлгэх (алдагдсан гэж үзвэл). */
  async rotatePayToken(id: string): Promise<{ payToken: string }> {
    const m = await this.find(id);
    m.payToken = randomBytes(24).toString('base64url');
    await this.repo.save(m);
    return { payToken: m.payToken };
  }

  // ── Дотоод ──

  async find(id: string): Promise<Member> {
    const m = await this.repo.findOne({ where: { id } });
    if (!m) throw new NotFoundException('Гишүүн олдсонгүй');
    return m;
  }

  private requirePhone(input: string): string {
    if (!isValidPhone(input)) {
      throw new BadRequestException(
        'Утасны дугаар буруу байна (8 оронтой, 5–9-өөр эхэлнэ)',
      );
    }
    return normalizePhone(input)!;
  }

  private async assertPhoneFree(phone: string, exceptId?: string): Promise<void> {
    const existing = await this.repo.findOne({
      where: exceptId ? { phone, id: Not(exceptId) } : { phone },
    });
    if (existing) {
      throw new ConflictException(
        `Энэ дугаар «${existing.name}» (№${existing.memberNo}) дээр бүртгэлтэй байна`,
      );
    }
  }

  /**
   * Дарааллаас дараагийн дугаар. Транзакц буцсан ч дугаар «идэгдэнэ» —
   * энэ нь ЗӨВ: дугаар дахин ашиглагдахгүй гэдэг баталгаа илүү чухал.
   */
  private async nextMemberNo(): Promise<number> {
    const rows = await this.ds.query<{ nextval: string }[]>(
      `SELECT nextval('member_no_seq')`,
    );
    return Number(rows[0].nextval);
  }

  private row(m: Member): MemberRow {
    const cardStage = stageOf(m);
    const tz = this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
    return {
      id: m.id,
      memberNo: m.memberNo,
      name: m.name,
      phone: m.phone,
      status: m.status,
      accessEndsAt: m.accessEndsAt,
      daysLeft: m.accessEndsAt
        ? daysBetween(new Date(), m.accessEndsAt, tz)
        : null,
      faceEnrolled: m.faceEnrolled,
      hasCard: !!m.loopyCardSerial,
      cardStage,
      lastVisitAt: m.lastVisitAt,
      syncError: m.hikSyncError,
    };
  }
}
