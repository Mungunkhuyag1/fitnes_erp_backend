import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, Repository, DataSource } from 'typeorm';
import { pageResult, type PageResult } from '../../common/dto/paginated';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { startOfLocalDay } from '../../common/utils/date.util';
import { splitTerminalName } from '../../common/utils/terminal-name.util';
import { Member } from '../member/member.entity';
import { DEVICE_GATEWAY, type DeviceGateway } from '../device/device.gateway';
import { terminalPath } from '../device/isapi/terminal-path';
import { mapAcsEvent, type RawAcsEvent } from './acs-event.mapper';
import { AccessEvent, AccessReason } from './access-event.entity';
import type { ListAccessEventsDto } from './dto/access.dto';

/** Нэг эвентийн зургийг дахин асуухын өмнөх ЗАВСАР. */
const PICTURE_RETRY_MS = 10 * 60_000;

/** Дэлгэрэнгүй нээхэд зураг хүлээх ДЭЭД хугацаа. */
const PICTURE_WAIT_MS = 6_000;

/**
 * Терминал хариугүй байвал ХЭР удаан огт оролдохгүй байх вэ.
 *
 * ⚠ Эвент тус бүрийн завсар ганцаараа хангалтгүй: терминал унтарсан үед
 * ажилтан 10 өөр уншуулалт нээвэл 10 удаа 6 секунд хүлээнэ. Нэг
 * бүтэлгүйтэл БҮГДИЙГ нь түр зогсоох ёстой.
 */
const PICTURE_COLD_MS = 2 * 60_000;

export interface IngestInput {
  deviceId?: string | null;
  employeeNo: string;
  eventAt: Date;
  granted?: boolean;
  reason?: AccessReason;
  verifyMode?: string | null;
  raw?: Record<string, unknown> | null;
  /** Терминалаас ирсэн дугаар — байвал давхардлыг үүгээр шүүнэ. */
  eventSeq?: number | null;
  /** Уншуулах үеийн зургийн бүтэн хаяг — замыг нь салгаж хадгална. */
  pictureUrl?: string | null;
}

/*
 * Эрэмбэлэх багана — ДТО-гийн цагаажсан жагсаалтаас ЗӨВХӨН.
 *
 * ⚠ Ажилтны өгсөн утгыг ШУУД `ORDER BY`-д ОРУУЛАХГҮЙ. Энэ
 *   зураглал ба DTO-гийн `@IsIn` хоёр хослоод SQL түлхэлтийг хаана.
 */
const ACCESS_SORT: Record<string, string> = {
  eventAt: 'e.event_at',
  memberNo: 'e.employee_no',
  reason: 'e.reason',
  verify: 'e.verify_mode',
};

@Injectable()
export class AccessService {
  private readonly log = new Logger(AccessService.name);

  constructor(
    @InjectRepository(AccessEvent)
    private readonly repo: Repository<AccessEvent>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly config: ConfigService,
    private readonly ds: DataSource,
    // Дэлгэрэнгүй нээхэд зураг нь дутуу бол ТЭР ДОР НЬ терминалаас асууна.
    @Inject(DEVICE_GATEWAY) private readonly device: DeviceGateway,
  ) {}

  /**
   * Аль эвентийн зургийг ХЭЗЭЭ хамгийн сүүлд асуусан бэ.
   *
   * ⚠ Терминал тэр зургаа дарж бичсэн бол хэзээ ч олдохгүй. Хамгаалалтгүй
   * бол ажилтан тэр цонхыг нээх бүрд, эсвэл жагсаалтаар гүйлгэх бүрд
   * терминал руу дэмий хүсэлт явна.
   */
  private readonly pictureTried = new Map<string, number>();

  /** Терминал хариугүй байсан — энэ хүртэл огт оролдохгүй. */
  private pictureColdUntil = 0;

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  // ══════════════════════════════════════════════════════════════
  //  Эвент хүлээн авах
  // ══════════════════════════════════════════════════════════════

  /**
   * Терминалын эвентийг бүртгэнэ.
   *
   * At-least-once (push + татагч хоёр замаар ирнэ) тул давхардлыг
   * `dedupeKey`-ээр шүүнэ — `ON CONFLICT DO NOTHING`.
   *
   * @returns шинээр бичигдсэн эсэх
   */
  async ingest(input: IngestInput): Promise<boolean> {
    const member = await this.members.findOne({
      where: { memberNo: input.employeeNo },
    });

    const granted = input.granted ?? this.decide(member) === AccessReason.OK;
    const reason = input.reason ?? this.decide(member);

    const res = await this.repo
      .createQueryBuilder()
      .insert()
      .into(AccessEvent)
      .values({
        deviceId: input.deviceId ?? null,
        memberId: member?.id ?? null,
        employeeNo: input.employeeNo,
        eventAt: input.eventAt,
        granted,
        reason,
        verifyMode: input.verifyMode ?? null,
        // ⚠ Хостыг нь ХАЯНА: терминалын IP солигдоход хадгалсан бүтэн
        // хаяг эзэнгүй болно (1788140000000).
        picturePath: terminalPath(input.pictureUrl),
        // `jsonb`-ийн TypeORM төрөл QueryBuilder-т таарахгүй тул cast хийнэ.
        raw: (input.raw ?? null) as never,
        dedupeKey: this.dedupeKey(input),
      })
      .orIgnore() // ON CONFLICT DO NOTHING — давхардсан эвент чимээгүй алгасна
      .execute();

    const inserted = (res.identifiers?.[0]?.id ?? null) !== null;

    /*
     * ★ ЗУРГЫГ ХОЙШ НӨХӨЖ БИЧНЭ.
     *
     * Түлхэлт (`httpHosts`) нь зургийн ХАЯГ илгээдэггүй — зураг нь
     * multipart-ын тусдаа хэсэгт ХОЁТОНоор ирдэг бөгөөд бид
     * түүнийг зориуд алгасдаг (`webhook-payload.ts`). Харин 5 минут
     * тутамын ТАТАГЧ (`AcsEvent` хайлт) `pictureURL`-ыг өгдөг.
     *
     * Гэвч тэр үед мөр нь АЛЬ ХЭДИЙН бичигдсэн байдаг тул
     * `orIgnore()` нь түүнийг чимээгүй хаяж, зураг ХЭЗЭЭ Ч ордоггүй
     * байв. Тиймээс давхардсан үед зӨВХӨН зургийг нь нөхнө.
     *
     * ⚠ `orUpdate()` болговол `inserted` үргэлж үнэн болж, «давхардсан»
     *   тоолуур алдагдана. Тиймээс тусдаа UPDATE.
     * ⚠ `picture_path IS NULL` — байгааг нь ДАРЖ бичихгүй.
     */
    const picturePath = terminalPath(input.pictureUrl);
    if (!inserted && picturePath) {
      await this.repo
        .createQueryBuilder()
        .update(AccessEvent)
        .set({ picturePath })
        .where('dedupe_key = :key AND picture_path IS NULL', {
          key: this.dedupeKey(input),
        })
        .execute();
    }

    // Сүүлийн ирэлтийн кэш — зөвхөн урагшлана (хоцорсон эвент буцаахгүй).
    if (inserted && granted && member) {
      if (!member.lastVisitAt || member.lastVisitAt < input.eventAt) {
        await this.members.update(member.id, { lastVisitAt: input.eventAt });
      }
    }
    return inserted;
  }

  /**
   * Үүлэн талын таамаг — терминал өөрөө локалаар шийддэг тул энэ нь ЗӨВХӨН
   * stub/демо өгөгдөлд хэрэглэгдэнэ. Жинхэнэ эвент дээр шалтгаан нь
   * терминалаас ирнэ.
   */
  private decide(member: Member | null): AccessReason {
    if (!member) return AccessReason.UNKNOWN_MEMBER;
    if (member.status === MemberStatus.SUSPENDED) return AccessReason.SUSPENDED;
    if (member.status === MemberStatus.CANCELLED) return AccessReason.NO_MATCH;
    if (!member.accessEndsAt || member.accessEndsAt.getTime() < Date.now()) {
      return AccessReason.EXPIRED;
    }
    return AccessReason.OK;
  }

  /**
   * Зураггүй үлдсэн уншуулалтын ЦАГИЙН ЦОНХнууд.
   *
   * ★ ЯАГААД ЦАГААР БҮЛЭГЛЭВ
   *
   * Эвент бүрд тусад нь терминал руу хандвал 50 зурагт 50 хүсэлт
   * болно. `AcsEvent` нь цонхоор хайдаг тул нэг цагийн цонх нэг
   * дуудлагаар тэр цагийн БҮХ зургийг авчирна.
   *
   * ⚠ Сүүлийн 2 минутыг ХАСНА: тэр эвентүүдийг 5 минут тутамын татагч
   * дөнгөж нөхөх гэж байгаа. Зэрэг мөргөлдвөл терминал руу давхар
   * хүсэлт явна.
   */
  async hoursMissingPictures(
    days: number,
    limit: number,
  ): Promise<{ hour: Date; count: number }[]> {
    return this.repo.query(
      `SELECT date_trunc('hour', event_at) AS hour, count(*)::int AS count
         FROM access_events
        WHERE picture_path IS NULL
          AND event_at >= now() - ($1 || ' days')::interval
          AND event_at <= now() - interval '2 minutes'
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT $2`,
      [days, limit],
    );
  }

  /** Заасан хоногт зураггүй хэдэн уншуулалт байна вэ. */
  async countMissingPictures(days: number): Promise<number> {
    const [r] = await this.repo.query<{ n: string }[]>(
      `SELECT count(*) AS n FROM access_events
        WHERE picture_path IS NULL
          AND event_at >= now() - ($1 || ' days')::interval`,
      [days],
    );
    return Number(r?.n ?? 0);
  }

  /**
   * Нэг эвентийн зургийг терминалаас ТАТАЖ ҮЗНЭ.
   *
   * ★ ГУРВАН ХЯЗГААРЛАЛТ
   *
   * 1. НАРИЙН ЦОНХ (±1 мин) — `AcsEvent` хайлт цонхоор ажилладаг тул
   *    өдрөөр асуувал хэдэн зуун мөр татаж, хариу удаашрана.
   *
   * 2. ХУГАЦААНЫ ТАГ — терминал унтарсан үед `fetchEvents` нь 15
   *    секунд хүлээдэг. Цонх нээхэд тэр чинээ гацвал ажилтан
   *    «эвдэрлээ» гэж бодно. Тиймээс хүлээлтийг тасалж зураггүй
   *    буцаана: суурь хүсэлт цаанаа үргэлжилж санг нөхнө, дараагийн
   *    нээлтэд харагдана.
   *
   * 3. ДАХИН ОРОЛДОХ ЗАВСАР — терминал хуучин зургаа дарж бичсэн бол
   *    хэзээ ч олдохгүй. Завсаргүй бол жагсаалт гүйлгэх бүрд дэмий
   *    хүсэлт явна.
   *
   * ⚠ ХЭЗЭЭ Ч ШИДЭХГҮЙ. Зураг нь тав тухтай зүйл, дэлгэрэнгүй нь
   * зайлшгүй: терминал унтарсан гэдгээр цонх нээгдэхгүй болох ёсгүй.
   */
  private async tryFetchPicture(e: AccessEvent): Promise<string | null> {
    if (e.picturePath || !e.employeeNo) return null;
    /*
     * ⚠ Stub нь экспортын эвентийг ЗААСАН ЦОНХОНД тааруулж буцаадаг.
     * Энд дуудвал дэлгэрэнгүй нээх бүрд хөгжүүлэлтийн санд хуурамч
     * ирц үүснэ — татагч ч мөн адил шалтгаанаар stub-ыг алгасдаг.
     */
    if (this.config.get<string>('gateways.device') === 'stub') return null;

    const now = Date.now();
    // Терминал дөнгөж хариу өгөөгүй бол бүгдийг нь алгасна.
    if (now < this.pictureColdUntil) return null;

    const last = this.pictureTried.get(e.id) ?? 0;
    if (now - last < PICTURE_RETRY_MS) return null;
    // Санах ой хязгааргүй өсөхгүй: хуучин бичлэгүүдийг цэвэрлэнэ.
    if (this.pictureTried.size > 500) this.pictureTried.clear();
    this.pictureTried.set(e.id, now);

    const at = e.eventAt.getTime();
    const from = new Date(at - 60_000);
    const to = new Date(at + 60_000);

    try {
      const raw = await Promise.race([
        this.device.fetchEvents(from, to) as Promise<RawAcsEvent[]>,
        new Promise<null>((r) => setTimeout(() => r(null), PICTURE_WAIT_MS)),
      ]);
      if (!raw) {
        // Удаан байна — цаана нь үргэлжилнэ, гэхдээ дараагийн цонхыг
        // дахин 6 секунд хүлээлгэхгүй.
        this.pictureColdUntil = Date.now() + PICTURE_COLD_MS;
        return null;
      }

      let mine: string | null = null;
      for (const row of raw) {
        const m = mapAcsEvent(row);
        if (!m || m.employeeNo === null || !m.pictureUrl) continue;
        // Бусдын зургийг ч нөхөж өгнө: нэг дуудлагаар ирсэн зүйлийг
        // хаях нь дэмий, цонх нь хэдхэн мөр агуулна.
        await this.ingest({
          employeeNo: m.employeeNo,
          eventAt: m.eventAt,
          granted: m.granted,
          verifyMode: m.verifyMode,
          reason: m.reason,
          raw: m.raw,
          pictureUrl: m.pictureUrl,
        });
        if (
          m.employeeNo === e.employeeNo &&
          Math.abs(m.eventAt.getTime() - at) < 1_000
        ) {
          mine = terminalPath(m.pictureUrl);
        }
      }
      if (mine) this.log.log(`Ирцийн зураг нөхөв: ${e.id}`);
      return mine;
    } catch (err) {
      // Терминал холбогдохгүй байх нь ХЭВИЙН — цонх зураггүй нээгдэнэ.
      this.pictureColdUntil = Date.now() + PICTURE_COLD_MS;
      this.log.debug(`Зураг татагдсангүй (${e.id}): ${(err as Error).message}`);
      return null;
    }
  }

  private dedupeKey(i: IngestInput): string {
    // Терминалын дугаар байвал тэр хамгийн найдвартай.
    if (i.eventSeq != null) return `${i.deviceId ?? 'x'}:${i.eventSeq}`;
    // Байхгүй бол агуулгаас hash — ижил хүн, ижил секунд, ижил хаалга.
    const sec = Math.floor(i.eventAt.getTime() / 1000);
    return createHash('sha1')
      .update(`${i.deviceId ?? 'x'}|${i.employeeNo}|${sec}`)
      .digest('hex')
      .slice(0, 40);
  }

  // ══════════════════════════════════════════════════════════════
  //  Жагсаалт
  // ══════════════════════════════════════════════════════════════

  async list(q: ListAccessEventsDto): Promise<PageResult<unknown>> {
    const qb = this.repo.createQueryBuilder('e');
    if (q.memberId) qb.andWhere('e.member_id = :mid', { mid: q.memberId });
    if (q.memberNo) qb.andWhere('e.employee_no = :no', { no: q.memberNo });
    if (q.deviceId) qb.andWhere('e.device_id = :did', { did: q.deviceId });
    if (q.granted !== undefined) {
      qb.andWhere('e.granted = :g', { g: q.granted });
    }
    if (q.reason) qb.andWhere('e.reason = :r', { r: q.reason });
    if (q.q?.trim()) {
      /*
       * Нэг талбараар ГУРВАН зүйл хайна: нэр, утас, № дугаар.
       *
       * ★ ДУГААРЫГ ДЭД АСУУЛГЫН ГАДНА ТАЛД ШАЛГАНА.
       *
       * Терминалаас ирсэн уншуулалтын ихэнх нь `member_id` нь NULL
       * — тэр хүн WinFit-д бүртгэлгүй эсвэл ирц нь импортоос ӨМНӨ
       * орсон байна. Хэрвээ дугаарыг ч `members` дэд асуулга дотор
       * шалгавал тэдгээр мөр ОГТ олдохгүй — тиймээс тусдаа шалгана.
       *
       * Дугаарын жишилт НЯГТ: `ILIKE '%5%'` болговол №5 хайхад
       * №455 ч олдоно.
       */
      const term = q.q.trim();
      const digits = term.replace(/\D/g, '');
      const no = term.replace(/[№#\s]/g, '');
      const inMembers = [`name ILIKE :like`];
      if (digits.length >= 2) inMembers.push('phone LIKE :digits');
      if (no) inMembers.push('member_no = :no');

      const parts = [
        `e.member_id IN (SELECT id FROM members WHERE ${inMembers.join(' OR ')})`,
      ];
      if (no) parts.push('e.employee_no = :no');

      qb.andWhere(`(${parts.join(' OR ')})`, {
        like: `%${term}%`,
        digits: `%${digits}%`,
        no,
      });
    }
    // `days` нь `from`-оос давуу — серверийн цагаар тооцно.
    const from =
      q.days !== undefined
        ? q.days === 0
          ? startOfLocalDay(new Date(), this.tz)
          : new Date(Date.now() - q.days * 86_400_000)
        : q.from;
    if (from) qb.andWhere('e.event_at >= :from', { from });
    if (q.to) qb.andWhere('e.event_at <= :to', { to: q.to });
    qb.orderBy(ACCESS_SORT[q.sort ?? ''] ?? 'e.event_at',
      q.sort || q.order ? q.direction : 'DESC',
    // Тогтвортой хуудаслалт: тэнцүү утгыг үе бүрд өөр дарааллаар
    // өгвөл нэг мөр хоёр хуудсанд гарах эсвэл бүрмөсөн алгасагдана.
    ).addOrderBy('e.id', 'DESC');

    const [rows, total] = await qb.skip(q.skip).take(q.take).getManyAndCount();
    return pageResult(await this.decorate(rows), total, q);
  }

  /**
   * Ирцийн товч үзүүлэлт.
   *
   * `days = 0` бол ӨНӨӨДӨР (локал цагаар), `null` бол бүх хугацаа.
   * Хугацааг СЕРВЕРТ тооцно — ажилтны компьютерын цаг зөрсөн ч тайлан
   * зөрөхгүй.
   */
  async stats(days: number | null) {
    const tz = this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
    // Салаа бүр ЗӨВХӨН өөрийн хэрэглэх параметрийг авна. Хэрэглээгүй
    // `$1` үлдээвэл PostgreSQL «could not determine data type» гэж унана —
    // дугаарлалт нь дараалсан бөгөөд бүгд ашиглагдсан байх ёстой.
    const [where, params]: [string, unknown[]] =
      days === null
        ? ['TRUE', []]
        : days === 0
          ? [
              `e.event_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1`,
              [tz],
            ]
          : [`e.event_at >= now() - ($1::text)::interval`, [`${days} days`]];

    const [row] = await this.ds.query<Record<string, string>[]>(
      `SELECT
         count(*) AS scans,
         count(*) FILTER (WHERE e.granted) AS granted,
         count(*) FILTER (WHERE NOT e.granted) AS denied,
         count(DISTINCT e.member_id) FILTER (WHERE e.granted) AS visitors
       FROM access_events e WHERE ${where}`,
      params,
    );
    const n = (k: string) => Number(row[k] ?? 0);
    const scans = n('scans');
    return {
      scans,
      granted: n('granted'),
      denied: n('denied'),
      visitors: n('visitors'),
      // Хувь нь 0 уншуулалт дээр утгагүй — `null` буцаана.
      denyRate: scans ? Math.round((n('denied') / scans) * 1000) / 10 : null,
    };
  }

  /** Dashboard-ийн шууд урсгал — сүүлийн 50. */
  async recent(limit = 50) {
    const rows = await this.repo.find({
      order: { eventAt: 'DESC', id: 'DESC' },
      take: Math.min(100, limit),
    });
    return { items: await this.decorate(rows) };
  }

  /** Өнөөдрийн ирц — «ӨДӨРТ 1 ИРЦ» дүрмээр (docs/05 §10.1). */
  async todayVisits(): Promise<number> {
    const from = startOfLocalDay(new Date(), this.tz);
    const row = await this.repo
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.member_id)', 'n')
      .where('e.granted = true')
      .andWhere('e.member_id IS NOT NULL')
      .andWhere('e.event_at >= :from', { from })
      .getRawOne<{ n: string }>();
    return Number(row?.n ?? 0);
  }

  /**
   * Нэг уншуулалтын бүх мэдээлэл.
   *
   * ★ ЯАГААД ЖАГСААЛТААС ТУСДАА ВЭ
   *
   * `raw` нь эвент бүрд хэдэн зуун байт JSON. Жагсаалтад 25 мөр татахад
   * түүнийг оруулбал хариу хэдэн арван КБ болно — 5,000 бичлэгтэй
   * жагсаалтыг гүйлгэхэд мэдэгдэхүйц удаашрана. Дэлгэрэнгүйг зөвхөн
   * ДАРСАН үед нэг мөрөөр татна.
   */
  async detail(id: string) {
    const e = await this.repo.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Ирц олдсонгүй');

    /*
     * ★ ЗУРАГ ДУТУУ БОЛ ЯГ ОДОО АСУУНА
     *
     * Зураг нь хоёр эх сурвалжаас нийлдэг: эвентийг түлхэлт авчирдаг ч
     * хаяггүй, 5 минут тутамын татагч хаягийг нь нөхдөг. Тунел
     * таслагдах, deploy хийх үед татагчийн цонх өнгөрч, зураг дутна.
     *
     * Цаг тутамын нөхөлт байгаа ч ажилтан ЯГ ОДОО «энэ хэн бэ» гэж
     * хардаг. Нэг цаг хүлээлгэх нь маргаан шийдэхэд хэрэггүй.
     */
    const path = await this.tryFetchPicture(e);
    if (path) e.picturePath = path;

    /*
     * Гишүүнийг ХОЁР аргаар хайна.
     *
     * `member_id` нь эвент бүртгэгдэх АГШИНД холбогдсон эсэхийг хэлнэ.
     * Терминалаас импортолсон хуучин ирц нь гишүүд WinFit-д орохоос
     * өмнөх байж болох ба тэр үед NULL үлдсэн. Дугаараар нь дахин
     * хайвал одоо байгаа гишүүнтэй тааруулж чадна — жагсаалт дээр
     * «Бүртгэлгүй» гэж харагдсан ч дэлгэрэнгүй дээр хэн болох нь
     * тодорно.
     */
    const member = e.memberId
      ? await this.members.findOne({ where: { id: e.memberId } })
      : e.employeeNo
        ? await this.members.findOne({ where: { memberNo: e.employeeNo } })
        : null;

    return {
      id: e.id,
      eventAt: e.eventAt,
      granted: e.granted,
      reason: e.reason,
      reasonLabel: REASON_LABEL[e.reason] ?? e.reason,
      verifyMode: e.verifyMode,
      picturePath: e.picturePath,
      memberNo: e.employeeNo,
      deviceId: e.deviceId,
      /*
       * Терминал дээр бичигдсэн нэр. Заал нэрийг регистртэй нь
       * нийлүүлж хадгалдаг («Usukhbayar km78042019») тул салгаж өгнө —
       * эс бөгөөс регистр нь нэрний хэсэг мэт харагдана.
       */
      terminalName: splitTerminalName(e.raw?.name)?.name ?? null,
      terminalRegister: splitTerminalName(e.raw?.name)?.register ?? null,
      member: member
        ? {
            id: member.id,
            name: member.name,
            memberNo: member.memberNo,
            phone: member.phone,
            status: member.status,
          }
        : null,
      /** Эвент бүртгэгдэх үед холбогдсон эсэх — дараа нь тааруулсан эсэхийг ялгана. */
      linkedAtIngest: e.memberId !== null,
      raw: e.raw,
    };
  }

  private async decorate(rows: AccessEvent[]) {
    const ids = [...new Set(rows.map((r) => r.memberId).filter(Boolean))] as string[];
    const members = ids.length
      ? await this.members.find({
          where: { id: In(ids) },
          select: { id: true, name: true, memberNo: true },
        })
      : [];
    const map = new Map(members.map((m) => [m.id, m]));
    return rows.map((r) => ({
      id: r.id,
      memberId: r.memberId,
      memberName: r.memberId ? (map.get(r.memberId)?.name ?? null) : null,
      /*
       * ТЕРМИНАЛ дээрх нэр — WinFit-д гишүүн олдоогүй үед хэн болохыг
       * хэлэх ЦОРЫН ГАНЦ эх сурвалж.
       *
       * Терминалаас импортолсон ирцийн ихэнх нь `member_id` нь NULL
       * (гишүүд ороогүй байхад бүртгэгдсэн). Гэвч түлхэлтийн биед
       * `name` талбар ирдэг тул жагсаалт дээр «Бүртгэлгүй (№246)»
       * гэхийн оронд жинхэнэ нэрийг харуулж чадна — туннель, импорт
       * аль нь ч шаардахгүй.
       */
      terminalName: splitTerminalName(r.raw?.name)?.name ?? null,
      memberNo: r.employeeNo,
      eventAt: r.eventAt,
      granted: r.granted,
      reason: r.reason,
      reasonLabel: REASON_LABEL[r.reason] ?? r.reason,
      verifyMode: r.verifyMode,
      // ⚠ ЗАМ — дэлгэц нь `/devices/image?path=…`-аар татна. Бүтэн
      // хаяг өгвөл браузер терминал руу шууд хандах ба нэвтрэлт,
      // сүлжээ хоёулаа зөрчилдөнө.
      picturePath: r.picturePath,
    }));
  }
}

export const REASON_LABEL: Record<string, string> = {
  ok: 'Зөвшөөрөв',
  expired: 'Хугацаа дууссан',
  suspended: 'Түр зогссон',
  no_match: 'Танигдсангүй',
  unknown_member: 'Бүртгэлгүй дугаар',
  other: 'Бусад',
};
