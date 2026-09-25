import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { startOfLocalDay } from '../../common/utils/date.util';
import type {
  TopMembersDto,
  AttendanceQueryDto,
  DateRangeDto,
  RevenueQueryDto,
} from './dto/report.dto';

/**
 * Нэгтгэл ба тайлан.
 *
 * Бүгд түүхий SQL-ээр — агрегац нь ORM-оор бичихэд уншихад хэцүү, удаан
 * болдог. Хамгийн чухал нь: цагийн бүсийг DB талд `AT TIME ZONE`-оор зөв
 * тооцох. Шөнө 01:00-д ирсэн хүн ӨМНӨХ өдрийн ирц болж тоологдох ёсгүй.
 */
/** Нүүр хуудасны хугацааны хүрээ. */
export type DashboardRange = '7d' | '30d' | '12m';

// ══════════════════════════════════════════════════════════════
//  АВЛАГА
// ══════════════════════════════════════════════════════════════

/** Заалны төлөгдөөгүй эрх — ГИШҮҮНЭЭР нэгтгэсэн. */
export interface GymReceivable {
  memberId: string;
  memberNo: string | null;
  name: string;
  phone: string | null;
  status: string;
  /** Нийт авах дүн — бүх төлөгдөөгүй мөрийн нийлбэр. */
  owed: number;
  /** Хэдэн удаа «дараа төлье» гэсэн бэ. */
  rows: number;
  packageName: string | null;
  /** ХАМГИЙН ЭРТ өрийн огноо. */
  since: Date;
  /** Тэр өдрөөс хойш хэд хоног. */
  days: number;
  /** Төлбөргүйгээр ХЭЗЭЭ хүртэл нэвтрэх эрх авсан. */
  accessUntil: Date | null;
  /** Сүүлд ХЭЗЭЭ ямар нэг төлбөр төлсөн (өр биш). */
  lastPaidAt: Date | null;
}

/** Йогийн ангийн үлдэгдэл — БҮРТГЭЛЭЭР (нэг хүн 2 ангид байж болно). */
export interface YogaReceivable {
  enrollmentId: string;
  courseId: string;
  courseName: string;
  courseEndsOn: string;
  memberId: string | null;
  name: string;
  phone: string | null;
  due: number;
  paid: number;
  owed: number;
  /** Бүртгүүлсэн огноо. */
  since: Date;
  days: number;
  /** Сүүлийн хэсэгчилсэн төлбөр — байхгүй бол хэзээ ч төлөөгүй. */
  lastPaidAt: Date | null;
}

/** SQL-ийн түүхий мөр — `bigint` нь `string`-ээр ирнэ. */
interface GymReceivableRow {
  member_id: string;
  member_no: string | null;
  name: string;
  phone: string | null;
  status: string;
  access_ends_at: Date | null;
  owed: string;
  rows: number;
  since: Date;
  days: number;
  access_until: Date | null;
  package_name: string | null;
  last_paid_at: Date | null;
}

interface YogaReceivableRow {
  enrollment_id: string;
  course_id: string;
  course_name: string;
  course_ends_on: string;
  archived_at: Date | null;
  member_id: string | null;
  name: string;
  phone: string | null;
  due: string;
  paid: string;
  owed: string;
  since: Date;
  days: number;
  last_paid_at: Date | null;
}


/**
 * Хүрээ бүрийн SQL параметрүүд.
 *
 * `unit` — `date_trunc`-ийн нэгж. 12 сарын хувьд ӨДРӨӨР бүлэглэвэл 365
 * цэг гарч, график уншигдахгүй болно.
 * `back` — `generate_series`-ийн эхлэл (сүүлийн цэг нь ӨНӨӨДӨР тул нэгээр
 * бага: 30 хоног = өнөөдөр + өмнөх 29).
 * `window` — өмнөх үетэй харьцуулах цонх.
 */
const RANGE_SPEC: Record<
  DashboardRange,
  { unit: 'day' | 'month'; back: string; window: string; label: string }
> = {
  '7d': { unit: 'day', back: '6 days', window: '7 days', label: 'Сүүлийн 7 хоног' },
  '30d': { unit: 'day', back: '29 days', window: '30 days', label: 'Сүүлийн 30 хоног' },
  '12m': { unit: 'month', back: '11 months', window: '12 months', label: 'Сүүлийн 12 сар' },
};

/*
 * ★ АЖИЛТНЫ ИРЦИЙГ ТАЙЛАНГААС ХАСАХ.
 *
 * Терминал дээр ажилтан, дасгалжуулагч нар өдөр бүр, заримдаа
 * өдөрт хэдэн удаа уншуулна. Тэднийг тооцвол «хамгийн идэвхтэй
 * гишүүд»-ийн дээд тал бүхэлдээ ажилтан болж, өдрийн ирц хэт
 * өндөр харагдана — бизнесийн шийдвэр гуйвана.
 *
 * ⚠ Аль хүн ажилтан бэ гэдгийг ТААМАГЛАХГҮЙ: `staff_user_id`
 * нь ажилтан ГАРААР холбосон тохиолдолд л дүүрэнэ
 * (migration 1788160000000). Холбоогүй ажилтан тайлангаас
 * ХАСАГДАХГҮЙ — энэ нь зориуд: систем өөрөө шийдэхгүй.
 *
 * Дэд асуулга нь `ix_members_not_staff` хэсэгчилсэн индексээр явна.
 */
const NOT_STAFF = (alias: string): string =>
  `${alias} IN (SELECT id FROM members WHERE staff_user_id IS NULL)`;

@Injectable()
export class ReportService {
  constructor(
    private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  private range(q: DateRangeDto): { from: Date; to: Date } {
    const to = q.to ?? new Date();
    if (q.days !== undefined) {
      return {
        from:
          q.days === 0
            ? startOfLocalDay(to, this.tz)
            : new Date(to.getTime() - q.days * 86_400_000),
        to,
      };
    }
    const from = q.from ?? new Date(to.getTime() - 30 * 86_400_000);
    return { from, to };
  }

  // ══════════════════════════════════════════════════════════════
  //  Нүүр хуудас — БҮГД нэг дуудлагаар
  // ══════════════════════════════════════════════════════════════

  async dashboard(range: DashboardRange = '30d') {
    const tz = this.tz;
    const [row] = await this.ds.query<Record<string, string | null>[]>(
      `
      WITH today AS (
        SELECT date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1 AS start
      )
      SELECT
        -- «Өдөрт 1 ирц» дүрэм: нэг хүн хэдэн ч удаа уншуулсан 1 гэж тооцно
        (SELECT count(DISTINCT member_id) FROM access_events, today
          WHERE granted AND member_id IS NOT NULL
            AND ${NOT_STAFF('member_id')}
            AND event_at >= today.start) AS today_visits,
        (SELECT count(*) FROM access_events, today
          WHERE event_at >= today.start) AS today_scans,
        (SELECT count(*) FROM access_events, today
          WHERE NOT granted AND event_at >= today.start) AS today_denied,

        (SELECT count(*) FROM members WHERE status = 'active') AS active_members,
        (SELECT count(*) FROM members WHERE status = 'expired') AS expired_members,
        (SELECT count(*) FROM members WHERE status = 'lead')    AS lead_members,
        (SELECT count(*) FROM members WHERE status = 'suspended') AS suspended_members,
        (SELECT count(*) FROM members WHERE status = 'cancelled') AS cancelled_members,

        -- Удахгүй дуусах — 7 хоног
        (SELECT count(*) FROM members
          WHERE status='active' AND access_ends_at IS NOT NULL
            AND access_ends_at <= now() + interval '7 days') AS expiring_total,
        -- ★ Картгүй нь чухал: тэдэнд Wallet push ХҮРЭХГҮЙ тул залгах ёстой
        (SELECT count(*) FROM members
          WHERE status='active' AND access_ends_at IS NOT NULL
            AND access_ends_at <= now() + interval '7 days'
            AND loopy_card_serial IS NULL) AS expiring_no_card,

        (SELECT count(*) FROM members
          WHERE NOT face_enrolled AND status <> 'cancelled') AS face_missing,
        -- ⚠ Утасгүй гишүүн Loopy-тэй ХОЛБОГДОХГҮЙ: тэнд утас нь гол
        -- түлхүүр. Терминалаас импортлосон гишүүд бүгд утасгүй ирдэг
        -- тул энэ нь ресепшний хамгийн том ажил болно.
        (SELECT count(*) FROM members
          WHERE phone IS NULL AND status <> 'cancelled') AS no_phone,
        (SELECT count(*) FROM members WHERE hik_sync_error IS NOT NULL) AS sync_error_members,
        (SELECT count(*) FROM outbox WHERE status = 'failed')  AS outbox_failed,
        (SELECT count(*) FROM outbox WHERE status = 'pending') AS outbox_pending,

        -- Шүүгээ
        (SELECT count(*) FROM locker_assignments WHERE returned_at IS NULL) AS keys_out,
        (SELECT count(*) FROM locker_assignments
          WHERE returned_at IS NULL AND due_at IS NOT NULL AND due_at < now()) AS lockers_overdue,
        -- Удахгүй дуусах ТҮРЭЭС. Хэтэрсний ДАРАА мэдэх нь оройтдог —
        -- ресепшн урьдчилж сунгуулах боломжтой байх ёстой.
        (SELECT count(*) FROM locker_assignments
          WHERE returned_at IS NULL AND due_at IS NOT NULL
            AND due_at >= now() AND due_at < now() + interval '7 days')
          AS lockers_expiring,
        -- Удаан буцаагдаагүй ӨДРИЙН түлхүүр.
        --
        -- ⚠ Хаалтын цагийн тохиргоо БАЙХГҮЙ тул «хаалтаар буцаагаагүй»
        -- гэж мэдэх боломжгүй. 6 цаг нь ойролцоо хэмжүүр: ердийн
        -- дасгалын хугацаанаас хамаагүй урт.
        (SELECT count(*) FROM locker_assignments
          WHERE returned_at IS NULL AND type = 'daily'
            AND issued_at < now() - interval '6 hours') AS daily_stale,

        -- Өнөөдрийн орлого, эх сурвалжаар
        --
        -- ⚠ paid_at-aap, created_at-аар БИШ. «Дараа төлөх»-өөр
        -- зарсан эрхийн мөнгө хараахан ирээгүй — түүнийг орлогод
        -- оруулбал кассын тайлан бодит мөнгөтэй таарахгүй болно.
        -- NULL харьцуулалт худал тул төлөгдөөгүй мөр өөрөө хасагдана.
        (SELECT coalesce(sum(amount),0) FROM memberships, today
          WHERE reversed_at IS NULL AND source='cash'  AND paid_at >= today.start) AS rev_cash,
        (SELECT coalesce(sum(amount),0) FROM memberships, today
          WHERE reversed_at IS NULL AND source='bonum' AND paid_at >= today.start) AS rev_bonum,
        (SELECT coalesce(sum(amount),0) FROM memberships, today
          WHERE reversed_at IS NULL AND source='manual' AND paid_at >= today.start) AS rev_manual,
        -- Йогийн өнөөдрийн орлого. ⚠ Огноог yoga_payments-аас авна:
        -- төлбөр хэсэгчилж ордог тул бүртгэлийн огноо тохирохгүй.
        (SELECT coalesce(sum(p.amount),0) FROM yoga_payments p, today
          WHERE p.paid_at >= today.start) AS rev_yoga,
        -- Цуглуулаагүй мөнгө — заал БА йог хоёулаа.
        (SELECT coalesce(sum(amount),0) FROM memberships
          WHERE reversed_at IS NULL AND paid_at IS NULL) AS receivable_gym,
        (SELECT coalesce(sum(e.amount_due - e.amount_paid),0)
           FROM yoga_enrollments e
           JOIN yoga_courses c ON c.id = e.course_id
          WHERE c.archived_at IS NULL
            AND e.amount_due > e.amount_paid) AS receivable_yoga,
        (SELECT count(DISTINCT member_id) FROM memberships
          WHERE reversed_at IS NULL AND paid_at IS NULL) AS receivable_members,
        (SELECT coalesce(sum(amount),0) FROM locker_assignments, today
          WHERE type='rental' AND issued_at >= today.start) AS rev_locker
      `,
      [tz],
    );

    const n = (k: string): number => Number(row[k] ?? 0);
    const devices = await this.ds.query<
      { id: string; name: string; online: boolean; last_seen_at: Date | null }[]
    >(`SELECT id, name, online, last_seen_at FROM devices WHERE active ORDER BY name`);

    return {
      today: {
        visits: n('today_visits'),
        scans: n('today_scans'),
        denied: n('today_denied'),
      },
      members: {
        active: n('active_members'),
        expired: n('expired_members'),
        lead: n('lead_members'),
        suspended: n('suspended_members'),
        cancelled: n('cancelled_members'),
      },
      expiringSoon: {
        total: n('expiring_total'),
        withoutCard: n('expiring_no_card'),
      },
      faceNotEnrolled: n('face_missing'),
      noPhone: n('no_phone'),
      lockers: {
        keysOut: n('keys_out'),
        overdueRentals: n('lockers_overdue'),
        expiringRentals: n('lockers_expiring'),
        staleDaily: n('daily_stale'),
      },
      revenueToday: {
        cash: n('rev_cash'),
        bonum: n('rev_bonum'),
        manual: n('rev_manual'),
        locker: n('rev_locker'),
        yoga: n('rev_yoga'),
        total:
          n('rev_cash') +
          n('rev_bonum') +
          n('rev_manual') +
          n('rev_locker') +
          n('rev_yoga'),
      },
      /**
       * Цуглуулаагүй мөнгө — «дараа төлөх»-өөр зарсан эрх.
       *
       * ⚠ Орлогод ОРОХГҮЙ. Нүүр дэлгэц дээр тусад нь харагдах ёстой:
       * ажилтан хэнээс мөнгө авахаа мэдэхгүй бол авлага мартагдана.
       */
      receivable: {
        /** Заал + йог. Ажилтан НИЙТ хэдийг авах ёстойгоо мэдэх ёстой. */
        amount: n('receivable_gym') + n('receivable_yoga'),
        gym: n('receivable_gym'),
        yoga: n('receivable_yoga'),
        members: n('receivable_members'),
      },
      sync: {
        memberErrors: n('sync_error_members'),
        outboxFailed: n('outbox_failed'),
        outboxPending: n('outbox_pending'),
      },
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        online: d.online,
        lastSeenAt: d.last_seen_at,
      })),
      ...(await this.dashboardExtras(tz, range)),
    };
  }

  /**
   * АВЛАГЫН ЖАГСААЛТ — хэнээс хэдийг авах вэ.
   *
   * ★ ЯАГААД ТООНООС ГАДНА ЖАГСААЛТ ХЭРЭГТЭЙ ВЭ
   *
   * Нүүр дэлгэц «⚠ Авлага 1,250,000₮» гэж ХЭМЖЭЭГ л хэлдэг байв. Тэр
   * нь ажилтанд ЮУ Ч хийлгэхгүй: хэнээс авахаа мэдэхгүй тул мөнгө
   * өөрөө ирэхийг хүлээнэ. Авлага бол ЗАЙЛШГҮЙ авах ёстой мөнгө —
   * гишүүн аль хэдийн заалаар орж, эрхээ хэрэглэж байна.
   *
   * ⚠ ГИШҮҮНЭЭР НЭГТГЭНЭ, мөрөөр биш. Нэг хүн 3 удаа «дараа төлье»
   * гэж сунгасан бол жагсаалтад 3 мөр гарах нь буруу: ажилтны
   * асуулт «Батаас хэдийг авах вэ?» — НЭГ дүн.
   *
   * ★ «ХЭД ХОНОГИЙН ӨМНӨ» НЬ ХАМГИЙН ХУУЧНААР
   *
   * Гишүүний ХАМГИЙН ЭРТ төлөгдөөгүй мөрөөр тоолно. 40 хоногийн
   * өмнөх өр нь өчигдрийн өртэй хамт «өчигдөр» гэж харагдвал
   * дараалал утгагүй болно.
   */
  async receivables(): Promise<{
    gym: GymReceivable[];
    yoga: YogaReceivable[];
    total: { gym: number; yoga: number; amount: number };
  }> {
    const tz = this.tz;
    const [gym, yoga] = await Promise.all([
      this.ds.query<GymReceivableRow[]>(
        `
        SELECT
          m.id                       AS member_id,
          m.member_no                AS member_no,
          m.name                     AS name,
          m.phone                    AS phone,
          m.status                   AS status,
          m.access_ends_at           AS access_ends_at,
          sum(u.amount)::bigint      AS owed,
          count(*)::int              AS rows,
          min(u.created_at)          AS since,
          /*
           * ⚠ ХОНОГИЙГ ХУАНЛИЙН ӨДРӨӨР — өнгөрсөн ЦАГААР биш.
           *
           * «(одоо - тэр үе) / 86400» гэж бодвол өчигдөр оройн 20:00-д
           * зарсан өр өнөөдөр 11:00-д «0 хоног» болж, дэлгэц дээр
           * «өнөөдөр» гэж харагдана. Ажилтан «шинэ өр» гэж андуурна.
           * Хоёр талыг УБ-ийн огноо болгож хасна.
           */
          ((now() AT TIME ZONE $1)::date
            - (min(u.created_at) AT TIME ZONE $1)::date)::int AS days,
          max(u.ends_at)             AS access_until,
          -- Хамгийн эрт өрийн БАГЦЫН нэр — «ямар эрхийг төлөөгүй вэ».
          (array_agg(u.package_name ORDER BY u.created_at))[1] AS package_name,
          /*
           * СҮҮЛД ХЭЗЭЭ ТӨЛСӨН — өөр асуулга.
           *
           * ⚠ Энэ нь өрийн мөрүүдээс биш, тухайн гишүүний БҮХ
           * төлөгдсөн мөрөөс. «Сүүлд 3 сарын өмнө төлсөн» нь
           * «өчигдөр төлсөн»-өөс тэс өөр дүгнэлт гаргуулна.
           */
          (SELECT max(p.paid_at) FROM memberships p
            WHERE p.member_id = m.id AND p.reversed_at IS NULL
              AND p.paid_at IS NOT NULL) AS last_paid_at
        FROM memberships u
        JOIN members m ON m.id = u.member_id
        WHERE u.reversed_at IS NULL
          AND u.paid_at IS NULL
          -- ⚠ 0₮ мөрийг хасна: чөлөө/бэлэг нь «төлбөргүй» биш,
          -- ТӨЛӨХ ЮМ БАЙХГҮЙ. Авлагад тоолбол жагсаалт хуурамч урт болно.
          AND u.amount > 0
        GROUP BY m.id, m.member_no, m.name, m.phone, m.status, m.access_ends_at
        ORDER BY min(u.created_at)
      `,
        [tz],
      ),
      this.ds.query<YogaReceivableRow[]>(
        `
        SELECT
          e.id                                AS enrollment_id,
          e.course_id                         AS course_id,
          c.name                              AS course_name,
          -- ⚠ «::text» — «date» багана нь Date объект болж ирдэг ба
          -- цагийн бүсээр хөрвөхөд өдөр гулсана. Текстээр авбал
          -- хуваарийн огноотой ЯГ таарна.
          c.ends_on::text                     AS course_ends_on,
          c.archived_at                       AS archived_at,
          e.member_id                         AS member_id,
          e.name                              AS name,
          e.phone                             AS phone,
          e.amount_due::bigint                AS due,
          e.amount_paid::bigint               AS paid,
          (e.amount_due - e.amount_paid)::bigint AS owed,
          e.created_at                        AS since,
          ((now() AT TIME ZONE $1)::date
            - (e.created_at AT TIME ZONE $1)::date)::int AS days,
          (SELECT max(p.paid_at) FROM yoga_payments p
            WHERE p.enrollment_id = e.id)     AS last_paid_at
        FROM yoga_enrollments e
        JOIN yoga_courses c ON c.id = e.course_id
        WHERE c.archived_at IS NULL
          AND e.amount_due > e.amount_paid
        ORDER BY e.created_at
      `,
        [tz],
      ),
    ]);

    const g = gym.map(
      (r): GymReceivable => ({
        memberId: r.member_id,
        memberNo: r.member_no,
        name: r.name,
        phone: r.phone,
        status: r.status,
        owed: Number(r.owed),
        rows: r.rows,
        packageName: r.package_name,
        since: r.since,
        days: r.days,
        accessUntil: r.access_until ?? r.access_ends_at,
        lastPaidAt: r.last_paid_at,
      }),
    );
    const y = yoga.map(
      (r): YogaReceivable => ({
        enrollmentId: r.enrollment_id,
        courseId: r.course_id,
        courseName: r.course_name,
        courseEndsOn: r.course_ends_on,
        memberId: r.member_id,
        name: r.name,
        phone: r.phone,
        due: Number(r.due),
        paid: Number(r.paid),
        owed: Number(r.owed),
        since: r.since,
        days: r.days,
        lastPaidAt: r.last_paid_at,
      }),
    );

    const sum = (xs: { owed: number }[]): number =>
      xs.reduce((a, b) => a + b.owed, 0);
    return {
      gym: g,
      yoga: y,
      total: { gym: sum(g), yoga: sum(y), amount: sum(g) + sum(y) },
    };
  }

  /**
   * Нүүр хуудасны график, хандлага, сүүлийн хөдөлгөөн.
   *
   * Үндсэн хайрцгуудаас ТУСДАА асуулга — тэр нь нэг мөр буцаадаг бөгөөд
   * эдгээр нь олон мөртэй. Нэг дуудлагад багтаах нь чухал: нүүр хуудас
   * 6-7 удаа сүлжээ рүү явбал ачаалал мэдэгдэхүйц удаашрана.
   */
  private async dashboardExtras(tz: string, range: DashboardRange) {
    const spec = RANGE_SPEC[range];
    const [trend, stages, recent, lockers, delta] = await Promise.all([
      // ── 30 хоногийн өдөр тутмын орлого + ирц ──
      // `generate_series` нь хөдөлгөөнгүй өдрийг ч 0 утгаар гаргана —
      // эс бөгөөс график дээр өдрүүд дутуу үлдэж, хандлага гуйвна.
      this.ds.query<
        { d: string; revenue: string; visits: string }[]
      >(
        `
        WITH buckets AS (
          SELECT generate_series(
            date_trunc($2, now() AT TIME ZONE $1) - ($3::text)::interval,
            date_trunc($2, now() AT TIME ZONE $1),
            ('1 ' || $2)::interval
          ) AS b
        )
        SELECT
          buckets.b::date::text AS d,
          coalesce((
            SELECT sum(m.amount) FROM memberships m
            WHERE m.reversed_at IS NULL
              -- ⚠ Мөнгө ИРСЭН өдрөөр, зарсан өдрөөр биш.
              AND date_trunc($2, m.paid_at AT TIME ZONE $1) = buckets.b
          ), 0) AS revenue,
          coalesce((
            SELECT count(DISTINCT e.member_id) FROM access_events e
            WHERE e.granted AND e.member_id IS NOT NULL
              AND ${NOT_STAFF('e.member_id')}
              AND date_trunc($2, e.event_at AT TIME ZONE $1) = buckets.b
          ), 0) AS visits
        FROM buckets ORDER BY buckets.b
        `,
        [tz, spec.unit, spec.back],
      ),

      // ── Wallet картын явц (docs/08 §12) ──
      this.ds.query<{ stage: string; c: string }[]>(
        `
        SELECT
          CASE
            WHEN loopy_allowed_at IS NULL                     THEN 'not_allowed'
            WHEN loopy_card_serial IS NULL                    THEN 'no_card'
            WHEN wallet_devices = 0                           THEN 'no_wallet'
            ELSE 'active'
          END AS stage,
          count(*) AS c
        FROM members WHERE status <> 'cancelled' GROUP BY 1
        `,
      ),

      // ── Сүүлийн ирц ──
      this.ds.query<
        {
          id: string;
          event_at: Date;
          granted: boolean;
          reason: string | null;
          member_id: string | null;
          name: string | null;
          member_no: number | null;
        }[]
      >(
        `
        SELECT e.id, e.event_at, e.granted, e.reason,
               e.member_id, m.name, m.member_no
        FROM access_events e
        LEFT JOIN members m ON m.id = e.member_id
        ORDER BY e.event_at DESC LIMIT 8
        `,
      ),

      // ── Гарсан шүүгээ ──
      // Хугацаа хэтэрсэн нь ЭХЭНД: ажилтан юуг эхлээд шийдэхийг мэдэх ёстой.
      this.ds.query<
        {
          id: string;
          zone: string;
          number: number;
          type: string;
          issued_at: Date;
          due_at: Date | null;
          amount: string;
          member_id: string;
          name: string | null;
          member_no: number | null;
        }[]
      >(
        `
        SELECT a.id, a.locker_zone AS zone, a.locker_number AS number,
               a.type, a.issued_at, a.due_at, a.amount,
               a.member_id, m.name, m.member_no
        FROM locker_assignments a
        LEFT JOIN members m ON m.id = a.member_id
        WHERE a.returned_at IS NULL
        ORDER BY
          (a.due_at IS NOT NULL AND a.due_at < now()) DESC,
          a.due_at NULLS LAST,
          a.issued_at DESC
        LIMIT 10
        `,
      ),

      // ── Сүүлийн 7 хоног vs өмнөх 7 хоног ──
      // Өчигдөртэй харьцуулбал фитнесийн 7 хоногийн мөчлөгөөс болж
      // утгагүй хэлбэлзэл гарна (Даваа vs Ням). Тиймээс 7/7.
      this.ds.query<Record<string, string>[]>(
        `
        SELECT
          coalesce((SELECT sum(amount) FROM memberships
            WHERE reversed_at IS NULL AND paid_at >= now() - ($1::text)::interval), 0) AS rev_now,
          coalesce((SELECT sum(amount) FROM memberships
            WHERE reversed_at IS NULL
              AND paid_at >= now() - (($1::text)::interval * 2)
              AND paid_at < now() - ($1::text)::interval), 0) AS rev_prev,
          (SELECT count(DISTINCT member_id) FROM access_events
            WHERE granted AND member_id IS NOT NULL
              AND event_at >= now() - ($1::text)::interval) AS vis_now,
          (SELECT count(DISTINCT member_id) FROM access_events
            WHERE granted AND member_id IS NOT NULL
              AND event_at >= now() - (($1::text)::interval * 2)
              AND event_at < now() - ($1::text)::interval) AS vis_prev,
          (SELECT count(*) FROM members
            WHERE created_at >= now() - ($1::text)::interval) AS new_now,
          (SELECT count(*) FROM members
            WHERE created_at >= now() - (($1::text)::interval * 2)
              AND created_at < now() - ($1::text)::interval) AS new_prev
        `,
        [spec.window],
      ),
    ]);

    const d = delta[0] ?? {};
    /** Хувийн өөрчлөлт. Өмнөх нь 0 бол хувь тооцох УТГАГҮЙ — `null`. */
    const pct = (now: unknown, prev: unknown): number | null => {
      const a = Number(now ?? 0);
      const b = Number(prev ?? 0);
      if (b === 0) return null;
      return Math.round(((a - b) / b) * 1000) / 10;
    };

    const stageMap = Object.fromEntries(stages.map((r) => [r.stage, Number(r.c)]));

    return {
      trend: trend.map((r) => ({
        date: r.d,
        revenue: Number(r.revenue),
        visits: Number(r.visits),
      })),
      cardStages: {
        notAllowed: stageMap.not_allowed ?? 0,
        noCard: stageMap.no_card ?? 0,
        noWallet: stageMap.no_wallet ?? 0,
        active: stageMap.active ?? 0,
      },
      recentEvents: recent.map((r) => ({
        id: r.id,
        eventAt: r.event_at,
        granted: r.granted,
        reason: r.reason,
        memberId: r.member_id,
        memberName: r.name,
        memberNo: r.member_no,
      })),
      openLockers: lockers.map((r) => ({
        id: r.id,
        zone: r.zone,
        number: r.number,
        type: r.type,
        issuedAt: r.issued_at,
        dueAt: r.due_at,
        amount: Number(r.amount ?? 0),
        memberId: r.member_id,
        memberName: r.name,
        memberNo: r.member_no,
        overdue: !!r.due_at && r.due_at.getTime() < Date.now(),
      })),
      range,
      rangeLabel: spec.label,
      period: {
        revenue: Number(d.rev_now ?? 0),
        visits: Number(d.vis_now ?? 0),
        newMembers: Number(d.new_now ?? 0),
        revenueDelta: pct(d.rev_now, d.rev_prev),
        visitsDelta: pct(d.vis_now, d.vis_prev),
        newMembersDelta: pct(d.new_now, d.new_prev),
      },
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  Тайлангууд
  // ══════════════════════════════════════════════════════════════

  async summary(q: DateRangeDto) {
    const { from, to } = this.range(q);
    const [row] = await this.ds.query<Record<string, string | null>[]>(
      `
      SELECT
        -- ⚠ Мөнгө ХҮЛЭЭН АВСАН огноогоор. Худалдан авалтын ТОО нь
        -- доор created_at-аар тоологдсон хэвээр — зарагдсан нь
        -- зарагдсан, мөнгө нь хожим ирж болно.
        (SELECT coalesce(sum(amount),0) FROM memberships
          WHERE reversed_at IS NULL AND paid_at BETWEEN $1 AND $2) AS membership_revenue,
        (SELECT coalesce(sum(amount),0) FROM memberships
          WHERE reversed_at IS NULL AND paid_at IS NULL
            AND created_at BETWEEN $1 AND $2) AS receivable,
        (SELECT coalesce(sum(p.amount),0) FROM yoga_payments p
          WHERE p.paid_at BETWEEN $1 AND $2) AS yoga_revenue,
        -- ⚠ Чөлөө нь memberships-д 0₮-ийн мөр болж бичигддэг
        -- (recompute нь дэвтрээс тооцдог тул өөр арга байхгүй).
        -- Орлогод нөлөөгүй ч ХУДАЛДАН АВАЛТ гэж тоологдох ЁСГҮЙ.
        (SELECT count(*) FROM memberships
          WHERE reversed_at IS NULL AND source <> 'freeze'
            AND created_at BETWEEN $1 AND $2) AS sales,
        (SELECT coalesce(sum(amount),0) FROM locker_assignments
          WHERE type='rental' AND issued_at BETWEEN $1 AND $2) AS locker_revenue,
        (SELECT count(*) FROM locker_assignments
          WHERE type='rental' AND issued_at BETWEEN $1 AND $2) AS locker_rentals,
        (SELECT count(*) FROM members WHERE created_at BETWEEN $1 AND $2) AS new_members,
        (SELECT count(*) FROM access_events
          WHERE granted AND event_at BETWEEN $1 AND $2) AS scans,
        (SELECT count(DISTINCT (member_id, (event_at AT TIME ZONE $3)::date))
           FROM access_events
          WHERE granted AND member_id IS NOT NULL
            AND ${NOT_STAFF('member_id')}
            AND event_at BETWEEN $1 AND $2) AS visits,
        (SELECT coalesce(sum(amount),0) FROM memberships
          WHERE reversed_at IS NOT NULL AND created_at BETWEEN $1 AND $2) AS reversed
      `,
      [from, to, this.tz],
    );
    const n = (k: string): number => Number(row[k] ?? 0);
    const revenue =
      n('membership_revenue') + n('locker_revenue') + n('yoga_revenue');
    return {
      range: { from, to },
      revenue: {
        membership: n('membership_revenue'),
        locker: n('locker_revenue'),
        /** ⚠ Тусдаа мөр — аль үйлчилгээ хэр ашигтайг ялгах боломжтой. */
        yoga: n('yoga_revenue'),
        total: revenue,
        reversed: n('reversed'),
        /**
         * Энэ мужид зарагдсан ч мөнгө нь ИРЭЭГҮЙ дүн.
         *
         * ⚠ `total`-д ОРООГҮЙ. Хоёрыг нэмбэл кассанд байгаа мөнгөтэй
         * таарахаа болино — тайлангийн гол хэрэглээ нь тэр тулгалт.
         */
        receivable: n('receivable'),
      },
      sales: n('sales'),
      lockerRentals: n('locker_rentals'),
      newMembers: n('new_members'),
      attendance: { visits: n('visits'), scans: n('scans') },
      /** Дундаж чек — нэг худалдан авалтад. */
      averageSale: n('sales') ? Math.round(n('membership_revenue') / n('sales')) : 0,
    };
  }

  async revenue(q: RevenueQueryDto) {
    const { from, to } = this.range(q);
    const unit =
      q.groupBy === 'month' ? 'month' : q.groupBy === 'week' ? 'week' : 'day';
    const rows = await this.ds.query<
      {
        bucket: string;
        cash: string;
        bonum: string;
        manual: string;
        locker: string;
        yoga: string;
      }[]
    >(
      `
      WITH ms AS (
        SELECT date_trunc($4, paid_at AT TIME ZONE $3) AS bucket,
               sum(amount) FILTER (WHERE source='cash')   AS cash,
               sum(amount) FILTER (WHERE source='bonum')  AS bonum,
               sum(amount) FILTER (WHERE source='manual') AS manual
        FROM memberships
        -- ⚠ Мөнгө ирсэн огноогоор бүлэглэнэ.
        WHERE reversed_at IS NULL AND paid_at BETWEEN $1 AND $2
        GROUP BY 1),
      lk AS (
        SELECT date_trunc($4, issued_at AT TIME ZONE $3) AS bucket,
               sum(amount) AS locker
        FROM locker_assignments
        WHERE type='rental' AND issued_at BETWEEN $1 AND $2
        GROUP BY 1),
      yg AS (
        SELECT date_trunc($4, paid_at AT TIME ZONE $3) AS bucket,
               sum(amount) AS yoga
        FROM yoga_payments
        WHERE paid_at BETWEEN $1 AND $2
        GROUP BY 1)
      SELECT to_char(coalesce(ms.bucket, lk.bucket, yg.bucket),
               CASE WHEN $4='month' THEN 'YYYY-MM' ELSE 'YYYY-MM-DD' END) AS bucket,
             coalesce(ms.cash,0) AS cash, coalesce(ms.bonum,0) AS bonum,
             coalesce(ms.manual,0) AS manual, coalesce(lk.locker,0) AS locker,
             coalesce(yg.yoga,0) AS yoga
      FROM ms
      FULL OUTER JOIN lk ON ms.bucket = lk.bucket
      FULL OUTER JOIN yg ON yg.bucket = coalesce(ms.bucket, lk.bucket)
      ORDER BY 1
      `,
      [from, to, this.tz, unit],
    );
    return {
      range: { from, to },
      groupBy: unit,
      items: rows.map((r) => {
        const cash = Number(r.cash);
        const bonum = Number(r.bonum);
        const manual = Number(r.manual);
        const locker = Number(r.locker);
        const yoga = Number(r.yoga);
        return {
          bucket: r.bucket,
          cash,
          bonum,
          manual,
          locker,
          yoga,
          total: cash + bonum + manual + locker + yoga,
        };
      }),
    };
  }

  async attendance(q: AttendanceQueryDto) {
    const { from, to } = this.range(q);
    const mode = q.groupBy ?? 'day';

    if (mode === 'day') {
      // Өдрийн ИРЦ — «өдөрт 1 хүн» дүрмээр.
      const rows = await this.ds.query<
        { bucket: string; visits: string; scans: string }[]
      >(
        `SELECT to_char((event_at AT TIME ZONE $3)::date,'YYYY-MM-DD') AS bucket,
                count(DISTINCT member_id) AS visits, count(*) AS scans
         FROM access_events
         WHERE granted AND member_id IS NOT NULL
           AND ${NOT_STAFF('member_id')}
           AND event_at BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`,
        [from, to, this.tz],
      );
      return {
        range: { from, to },
        groupBy: mode,
        items: rows.map((r) => ({
          bucket: r.bucket,
          visits: Number(r.visits),
          scans: Number(r.scans),
        })),
      };
    }

    // Цаг / долоо хоногийн өдөр — АЧААЛЛЫН шинжилгээ тул бүх уншуулалт.
    const expr =
      mode === 'hour'
        ? `extract(hour FROM event_at AT TIME ZONE $3)::int`
        : `extract(isodow FROM event_at AT TIME ZONE $3)::int`;
    const rows = await this.ds.query<{ bucket: number; scans: string }[]>(
      `SELECT ${expr} AS bucket, count(*) AS scans
       FROM access_events
       WHERE granted AND event_at BETWEEN $1 AND $2
       GROUP BY 1 ORDER BY 1`,
      [from, to, this.tz],
    );
    const WEEKDAY = ['Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба', 'Ням'];
    return {
      range: { from, to },
      groupBy: mode,
      items: rows.map((r) => ({
        bucket: Number(r.bucket),
        label:
          mode === 'hour'
            ? `${String(r.bucket).padStart(2, '0')}:00`
            : WEEKDAY[Number(r.bucket) - 1],
        scans: Number(r.scans),
      })),
    };
  }

  async members(q: DateRangeDto) {
    const { from, to } = this.range(q);
    const [byStatus, growth] = await Promise.all([
      this.ds.query<{ status: string; n: string }[]>(
        `SELECT status, count(*) AS n FROM members GROUP BY 1 ORDER BY 1`,
      ),
      this.ds.query<{ bucket: string; joined: string }[]>(
        `SELECT to_char(date_trunc('month', created_at AT TIME ZONE $3),'YYYY-MM') AS bucket,
                count(*) AS joined
         FROM members WHERE created_at BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`,
        [from, to, this.tz],
      ),
    ]);
    return {
      range: { from, to },
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
      growth: growth.map((r) => ({
        bucket: r.bucket,
        joined: Number(r.joined),
      })),
    };
  }

  /**
   * Багц тус бүрийн борлуулалт.
   *
   * Багц устгагдсан / нэр солигдсон байж болзошгүй тул `memberships` дээрх
   * `package_id`-аар нэгтгээд нэрийг LEFT JOIN-оор авна — багц устсан ч
   * түүхэн борлуулалт тайлангаас алга болохгүй.
   */
  async packages(q: DateRangeDto) {
    const { from, to } = this.range(q);
    const rows = await this.ds.query<
      { name: string | null; days: string; sales: string; revenue: string }[]
    >(
      `SELECT coalesce(p.name, 'Гараар') AS name,
              coalesce(max(p.days)::text, '') AS days,
              count(*) AS sales,
              coalesce(sum(m.amount), 0) AS revenue
       FROM memberships m
       LEFT JOIN packages p ON p.id = m.package_id
       -- Чөлөө нь багц биш — «Гараар» мөрөнд орж тоог гуйвуулах ёсгүй.
       WHERE m.reversed_at IS NULL AND m.source <> 'freeze'
         AND m.created_at BETWEEN $1 AND $2
       GROUP BY coalesce(p.name, 'Гараар')
       ORDER BY revenue DESC`,
      [from, to],
    );
    return {
      range: { from, to },
      items: rows.map((r) => ({
        name: r.name ?? 'Гараар',
        days: r.days ? Number(r.days) : null,
        sales: Number(r.sales),
        revenue: Number(r.revenue),
      })),
    };
  }

  /**
   * Хамгийн олон ирсэн гишүүд — «өдөрт 1» дүрмээр.
   *
   * ⚠ Ажилтны данстай холбогдсон хүнийг ХАСНА (`NOT_STAFF`).
   *   Ажилтан өдөр бүр уншуулдаг тул энэ жагсаалтын дээд талыг
   *   бүрэн эзлэх бөгөөд жинхэнэ гишүүд харагдахгүй болно.
   */
  async topMembers(q: TopMembersDto) {
    const { from, to } = this.range(q);
    // Хязгаарыг ПАРАМЕТРээр ӨГДӨГГҮЙ — DTO нь 1..100 гэж шалгасан
    // бүхэл тоо болгосон тул шууд байрлуулах нь аюулгүй.
    const limit = Math.min(Math.max(Math.trunc(q.limit ?? 10), 1), 100);
    const rows = await this.ds.query<
      {
        id: string;
        name: string;
        member_no: string;
        visits: string;
        last_visit: Date | null;
      }[]
    >(
      `SELECT m.id, m.name, m.member_no,
              count(DISTINCT (e.event_at AT TIME ZONE $3)::date) AS visits,
              max(e.event_at) AS last_visit
       FROM access_events e
       JOIN members m ON m.id = e.member_id
       WHERE e.granted AND e.event_at BETWEEN $1 AND $2
         AND m.staff_user_id IS NULL
       GROUP BY m.id, m.name, m.member_no
       ORDER BY visits DESC, last_visit DESC
       LIMIT ${limit}`,
      [from, to, this.tz],
    );
    return {
      range: { from, to },
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        memberNo: r.member_no,
        visits: Number(r.visits),
        lastVisit: r.last_visit,
      })),
    };
  }
}
