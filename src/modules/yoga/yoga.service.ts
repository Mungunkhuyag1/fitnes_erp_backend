import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DEVICE_GATEWAY, type DeviceGateway } from '../device/device.gateway';
import { Member } from '../member/member.entity';
import {
  AddPaymentDto,
  CreateYogaCourseDto,
  CreateYogaEnrollmentDto,
  ListYogaCoursesDto,
  MarkAttendanceDto,
  UpdateYogaCourseDto,
  UpdateYogaEnrollmentDto,
} from './dto/yoga.dto';
import { YogaAttendance } from './yoga-attendance.entity';
import { YogaCourse } from './yoga-course.entity';
import { YogaEnrollment } from './yoga-enrollment.entity';
import { YogaPayment } from './yoga-payment.entity';
import {
  courseSessions,
  courseState,
  nextSession,
  todayIn,
  type CourseState,
} from './yoga.schedule';

export interface YogaCourseView {
  id: string;
  name: string;
  instructor: string | null;
  startsOn: string;
  endsOn: string;
  weekdays: number[];
  startTime: string;
  durationMin: number;
  capacity: number | null;
  price: number;
  note: string | null;
  archivedAt: Date | null;
  /** Хуваарийн төлөв — эхлээгүй / явагдаж буй / дууссан. */
  state: CourseState;
  /** Нийт оролтын тоо (тооцоолсон). */
  sessions: number;
  /** Өнөөдөр эсвэл дараагийн оролт. `null` = дууссан. */
  nextOn: string | null;
  enrolled: number;
  /** Төлөх ёстой нийт. */
  due: number;
  /** Хүлээн авсан нийт. */
  paid: number;
  /** Үлдэгдэл = due − paid. */
  owed: number;
}

/**
 * Йогийн анги, гишүүд, ирц.
 *
 * ★ ЗААЛНААС ТУСДАА
 *
 * `memberships`, `access_events`, outbox аль нэгд нь ХҮРДЭГГҮЙ. Йогийн
 * мөнгө заалны орлогод ОРОХГҮЙ — захиалагч тусдаа тооцоо хүссэн.
 *
 * ⚠ ГАНЦ ХОЛБОГДОХ ЦЭГ нь ХААЛГА: ирц бүртгэхэд терминалыг зайнаас
 * нээнэ. Энэ нь өгөгдөл БИЧИХГҮЙ (`openDoor`) тул `DEVICE_WRITES=off`
 * үед ч ажиллана.
 */
@Injectable()
export class YogaService {
  private readonly log = new Logger(YogaService.name);

  constructor(
    @InjectRepository(YogaCourse)
    private readonly courses: Repository<YogaCourse>,
    @InjectRepository(YogaEnrollment)
    private readonly enrollments: Repository<YogaEnrollment>,
    @InjectRepository(YogaAttendance)
    private readonly attendance: Repository<YogaAttendance>,
    @InjectRepository(YogaPayment)
    private readonly payments: Repository<YogaPayment>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @Inject(DEVICE_GATEWAY) private readonly device: DeviceGateway,
    private readonly config: ConfigService,
    private readonly ds: DataSource,
  ) {}

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  private get today(): string {
    return todayIn(this.tz);
  }

  // ══════════════════════════════════════════════════════════════
  //  Анги
  // ══════════════════════════════════════════════════════════════

  async createCourse(dto: CreateYogaCourseDto): Promise<YogaCourseView> {
    if (dto.endsOn < dto.startsOn) {
      throw new BadRequestException('Дуусах огноо эхлэхээсээ өмнө байна');
    }
    const saved = await this.courses.save(
      this.courses.create({
        name: dto.name.trim(),
        instructor: dto.instructor?.trim() || null,
        startsOn: dto.startsOn,
        endsOn: dto.endsOn,
        weekdays: [...new Set(dto.weekdays)].sort((a, b) => a - b),
        startTime: dto.startTime ?? '19:00',
        durationMin: dto.durationMin ?? 60,
        capacity: dto.capacity ?? null,
        price: String(dto.price ?? 0),
        note: dto.note?.trim() || null,
      }),
    );
    this.log.log(`Йогийн анги: ${saved.name} (${saved.startsOn}→${saved.endsOn})`);
    return this.getCourse(saved.id);
  }

  async listCourses(q: ListYogaCoursesDto): Promise<YogaCourseView[]> {
    const qb = this.courses.createQueryBuilder('c');
    if (!q.includeArchived) qb.andWhere('c.archived_at IS NULL');
    if (q.q?.trim()) {
      const t = `%${q.q.trim()}%`;
      qb.andWhere('(c.name ILIKE :t OR c.instructor ILIKE :t)', { t });
    }
    /*
     * ⚠ Төлвийг SQL дээр шүүнэ, санах ойд биш: ирээдүйд анги олон
     * болоход бүгдийг татаад шүүх нь дэмий.
     */
    const today = this.today;
    if (q.state === 'upcoming') qb.andWhere('c.starts_on > :d', { d: today });
    if (q.state === 'finished') qb.andWhere('c.ends_on < :d', { d: today });
    if (q.state === 'active') {
      qb.andWhere('c.starts_on <= :d AND c.ends_on >= :d', { d: today });
    }
    qb.orderBy('c.starts_on', 'DESC');

    const rows = await qb.getMany();
    if (!rows.length) return [];
    const stats = await this.statsFor(rows.map((r) => r.id));
    return rows.map((c) => this.view(c, stats.get(c.id)));
  }

  async getCourse(id: string): Promise<YogaCourseView> {
    const c = await this.courses.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Анги олдсонгүй');
    const stats = await this.statsFor([id]);
    return this.view(c, stats.get(id));
  }

  async updateCourse(
    id: string,
    dto: UpdateYogaCourseDto,
  ): Promise<YogaCourseView> {
    const c = await this.courses.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Анги олдсонгүй');

    if (dto.name !== undefined) c.name = dto.name.trim();
    if (dto.instructor !== undefined) c.instructor = dto.instructor.trim() || null;
    if (dto.startsOn !== undefined) c.startsOn = dto.startsOn;
    if (dto.endsOn !== undefined) c.endsOn = dto.endsOn;
    if (dto.weekdays !== undefined) {
      c.weekdays = [...new Set(dto.weekdays)].sort((a, b) => a - b);
    }
    if (dto.startTime !== undefined) c.startTime = dto.startTime;
    if (dto.durationMin !== undefined) c.durationMin = dto.durationMin;
    if (dto.capacity !== undefined) c.capacity = dto.capacity;
    if (dto.price !== undefined) c.price = String(dto.price);
    if (dto.note !== undefined) c.note = dto.note.trim() || null;
    if (dto.archived !== undefined) {
      c.archivedAt = dto.archived ? new Date() : null;
    }
    if (c.endsOn < c.startsOn) {
      throw new BadRequestException('Дуусах огноо эхлэхээсээ өмнө байна');
    }

    await this.courses.save(c);
    return this.getCourse(id);
  }

  /**
   * Анги устгах.
   *
   * ⚠ Гишүүнтэй ангийг УСТГАХГҮЙ — төлбөр, ирцийн бүртгэл алга болно.
   * Оронд нь АРХИВЛАНА (`archived`): жагсаалтаас нуугдах ч өгөгдөл
   * үлдэнэ.
   */
  async deleteCourse(id: string): Promise<{ ok: true }> {
    const n = await this.enrollments.count({ where: { courseId: id } });
    if (n > 0) {
      throw new ConflictException(
        `${n} хүн бүртгүүлсэн байна — устгах биш АРХИВЛАНА уу ` +
          '(төлбөр, ирцийн бүртгэл хадгалагдана).',
      );
    }
    const r = await this.courses.delete(id);
    if (!r.affected) throw new NotFoundException('Анги олдсонгүй');
    return { ok: true as const };
  }

  // ══════════════════════════════════════════════════════════════
  //  Цагийн хуваарь
  // ══════════════════════════════════════════════════════════════

  /**
   * Ангийн бүх оролт — ирцийн тоотой нь хамт.
   *
   * ⚠ Өнгөрсөн, ирээдүйг ялгана: ирээдүйн оролт дээр «хэн ч ирээгүй»
   * гэж улаанаар харуулбал ажилтныг дэмий сандраана.
   */
  async schedule(courseId: string) {
    const c = await this.courses.findOne({ where: { id: courseId } });
    if (!c) throw new NotFoundException('Анги олдсонгүй');

    const days = courseSessions(c);
    const enrolled = await this.enrollments.count({ where: { courseId } });

    const rows = await this.attendance.query<
      { session_on: string; n: string }[]
    >(
      `SELECT to_char(a.session_on, 'YYYY-MM-DD') AS session_on, count(*) AS n
         FROM yoga_attendance a
         JOIN yoga_enrollments e ON e.id = a.enrollment_id
        WHERE e.course_id = $1
        GROUP BY 1`,
      [courseId],
    );
    const byDay = new Map(rows.map((r) => [r.session_on, Number(r.n)]));

    const today = this.today;
    return {
      courseId,
      startTime: c.startTime,
      durationMin: c.durationMin,
      enrolled,
      today,
      sessions: days.map((d) => ({
        on: d,
        attended: byDay.get(d) ?? 0,
        past: d < today,
        isToday: d === today,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  Гишүүд
  // ══════════════════════════════════════════════════════════════

  /**
   * Ангийн гишүүд — төлбөрийн байдал, ирцийн тоотой.
   *
   * Шүүх/эрэмбэлэхийг ДЭЛГЭЦ хийнэ: нэг ангид хамгийн ихдээ хэдэн
   * арван хүн байх тул бүгдийг өгөөд клиент талд шүүх нь хуудаслалт,
   * эрэмбийн SQL бичихээс энгийн бөгөөд шуурхай.
   */
  async listEnrollments(courseId: string) {
    const rows = await this.enrollments.query<
      {
        id: string;
        member_id: string | null;
        name: string;
        phone: string | null;
        amount_due: string;
        amount_paid: string;
        note: string | null;
        created_at: Date;
        attended: string;
        last_on: string | null;
      }[]
    >(
      `SELECT e.id, e.member_id, e.name, e.phone, e.amount_due, e.amount_paid,
              e.note, e.created_at,
              count(a.*)                               AS attended,
              to_char(max(a.session_on), 'YYYY-MM-DD') AS last_on
         FROM yoga_enrollments e
         LEFT JOIN yoga_attendance a ON a.enrollment_id = e.id
        WHERE e.course_id = $1
        GROUP BY e.id
        ORDER BY e.created_at ASC`,
      [courseId],
    );
    return rows.map((r) => {
      const due = Number(r.amount_due);
      const paid = Number(r.amount_paid);
      return {
        id: r.id,
        memberId: r.member_id,
        name: r.name,
        phone: r.phone,
        amountDue: due,
        amountPaid: paid,
        owed: Math.max(0, due - paid),
        /** `paid` · `partial` · `unpaid` — дэлгэцийн шүүлтүүрт. */
        payment: paid >= due ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
        attended: Number(r.attended),
        lastOn: r.last_on,
        note: r.note,
        createdAt: r.created_at,
      };
    });
  }

  async addEnrollment(
    courseId: string,
    dto: CreateYogaEnrollmentDto,
    staffUserId: string,
  ) {
    const c = await this.courses.findOne({ where: { id: courseId } });
    if (!c) throw new NotFoundException('Анги олдсонгүй');
    if (c.archivedAt) throw new BadRequestException('Архивласан ангид бүртгэхгүй');

    /*
     * Нэрийг ГИШҮҮНЭЭС авна. Гараар бичсэн нэр гишүүний бүртгэлтэй
     * зөрвөл дараа нь аль нь үнэн болох нь тодорхойгүй болно.
     */
    let name = dto.name?.trim() ?? '';
    let phone = dto.phone?.trim() || null;
    if (dto.memberId) {
      const m = await this.members.findOne({ where: { id: dto.memberId } });
      if (!m) throw new NotFoundException('Гишүүн олдсонгүй');
      name = m.name;
      phone = phone ?? m.phone;
      const dup = await this.enrollments.findOne({
        where: { courseId, memberId: dto.memberId },
      });
      if (dup) throw new ConflictException('Энэ гишүүн аль хэдийн бүртгэгдсэн');
    }
    if (!name) throw new BadRequestException('Нэр эсвэл гишүүнийг заана уу');

    if (c.capacity !== null) {
      const n = await this.enrollments.count({ where: { courseId } });
      if (n >= c.capacity) {
        throw new ConflictException(
          `Анги дүүрсэн (${c.capacity} хүн). Багтаамжийг нэмэгдүүлнэ үү.`,
        );
      }
    }

    const due = dto.amountDue ?? Number(c.price);
    const paid = dto.amountPaid ?? 0;
    const saved = await this.enrollments.save(
      this.enrollments.create({
        courseId,
        memberId: dto.memberId ?? null,
        name,
        phone,
        amountDue: String(due),
        amountPaid: String(paid),
        note: dto.note?.trim() || null,
        staffUserId,
      }),
    );
    /*
     * ⚠ Эхний төлбөрийг ч МӨР болгож бичнэ. Зөвхөн `amount_paid`
     * шинэчилбэл тэр мөнгө тайланд ХЭЗЭЭ Ч харагдахгүй — огноогүй тул.
     */
    if (paid > 0) {
      await this.payments.save(
        this.payments.create({
          enrollmentId: saved.id,
          amount: String(paid),
          staffUserId,
          note: 'Бүртгэх үед',
        }),
      );
    }

    this.log.log(
      `Йог: ${name} → ${c.name} (${paid}/${due}₮${paid < due ? ' — үлдэгдэлтэй' : ''})`,
    );
    return saved;
  }

  async updateEnrollment(id: string, dto: UpdateYogaEnrollmentDto) {
    const e = await this.enrollments.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Бүртгэл олдсонгүй');
    if (dto.name !== undefined) e.name = dto.name.trim();
    if (dto.phone !== undefined) e.phone = dto.phone.trim() || null;
    if (dto.amountDue !== undefined) e.amountDue = String(dto.amountDue);
    if (dto.amountPaid !== undefined) e.amountPaid = String(dto.amountPaid);
    if (dto.note !== undefined) e.note = dto.note.trim() || null;
    await this.enrollments.save(e);
    return e;
  }

  /**
   * Нэмэлт төлбөр хүлээн авах — үлдэгдэл дээр НЭМНЭ.
   *
   * ⚠ Орлуулахгүй НЭМНЭ: йогийн төлбөр хэсэгчилж ордог бөгөөд
   * ажилтан «одоо хэдийг авсан»-аа бичих нь «нийт хэд болсон»-оос
   * хамаагүй бага алдаатай.
   */
  async addPayment(id: string, dto: AddPaymentDto, staffUserId?: string) {
    const e = await this.enrollments.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Бүртгэл олдсонгүй');

    // Огноотой мөр — тайлан эндээс уншина.
    await this.payments.save(
      this.payments.create({
        enrollmentId: e.id,
        amount: String(dto.amount),
        staffUserId: staffUserId ?? null,
      }),
    );
    // `amount_paid` нь КЭШ — жагсаалт болгонд нийлбэр хийхгүйн тулд.
    e.amountPaid = String(Number(e.amountPaid) + dto.amount);
    await this.enrollments.save(e);
    this.log.log(`Йог төлбөр: ${e.name} +${dto.amount}₮`);
    return {
      ok: true as const,
      amountPaid: Number(e.amountPaid),
      owed: Math.max(0, Number(e.amountDue) - Number(e.amountPaid)),
    };
  }

  async removeEnrollment(id: string): Promise<{ ok: true }> {
    const r = await this.enrollments.delete(id);
    if (!r.affected) throw new NotFoundException('Бүртгэл олдсонгүй');
    return { ok: true as const };
  }

  // ══════════════════════════════════════════════════════════════
  //  Ирц
  // ══════════════════════════════════════════════════════════════

  /**
   * Ирц бүртгэж, ХААЛГЫГ НЭЭНЭ.
   *
   * ★ ХАЯЛГА НЭЭХ НЬ ГОЛ ХЭРЭГЛЭЭ
   *
   * Ресепшн ирцийг яг хаалган дээр бүртгэдэг. Тусад нь «хаалга нээх»
   * товч дарах шаардлагатай бол нэг нь мартагдаж, дараалал үүснэ.
   *
   * ⚠ ТЕРМИНАЛ УНАСАН Ч ИРЦ БҮРТГЭГДЭНЭ. Хаалга нээгдсэн эсэхийг
   * хариунд ТУСАД нь хэлнэ — бүртгэл нь мөнгөтэй холбоотой тул
   * төхөөрөмжийн эвдрэлээс болж алдагдах ёсгүй.
   */
  async markAttendance(
    courseId: string,
    dto: MarkAttendanceDto,
    staffUserId: string,
  ) {
    const c = await this.courses.findOne({ where: { id: courseId } });
    if (!c) throw new NotFoundException('Анги олдсонгүй');

    const e = await this.enrollments.findOne({
      where: { id: dto.enrollmentId, courseId },
    });
    if (!e) throw new NotFoundException('Энэ ангид тийм бүртгэл алга');

    // Хуваарьт байхгүй өдрийг хүлээж авахгүй — бичиг баримт бохирдоно.
    if (!courseSessions(c).includes(dto.sessionOn)) {
      throw new BadRequestException(
        `${dto.sessionOn} нь энэ ангийн хуваарьт байхгүй байна`,
      );
    }

    /*
     * ⚠ Давхар дарахад алдаа шидэхгүй. Ресепшн хоёр удаа дарах нь
     * элбэг бөгөөд тэр үед хаалга нээгдэх ёстой — «аль хэдийн
     * бүртгэгдсэн» гэж зогсоовол хүн гадаа үлдэнэ.
     */
    const existing = await this.attendance.findOne({
      where: { enrollmentId: e.id, sessionOn: dto.sessionOn },
    });
    if (!existing) {
      await this.attendance.save(
        this.attendance.create({
          enrollmentId: e.id,
          sessionOn: dto.sessionOn,
          staffUserId,
        }),
      );
    }

    let door: { opened: boolean; error?: string } = { opened: false };
    if (dto.openDoor !== false) {
      try {
        await this.device.openDoor();
        door = { opened: true };
      } catch (err) {
        door = { opened: false, error: (err as Error).message };
        this.log.warn(`Йог: хаалга нээгдсэнгүй — ${(err as Error).message}`);
      }
    }

    this.log.log(
      `Йог ирц: ${e.name} · ${dto.sessionOn}${door.opened ? ' · хаалга нээв' : ''}`,
    );
    return { ok: true as const, already: !!existing, door };
  }

  /** Ирцийг буцаах — андуурч дарсан үед. */
  async unmarkAttendance(
    courseId: string,
    enrollmentId: string,
    sessionOn: string,
  ): Promise<{ ok: true }> {
    const e = await this.enrollments.findOne({
      where: { id: enrollmentId, courseId },
    });
    if (!e) throw new NotFoundException('Энэ ангид тийм бүртгэл алга');
    await this.attendance.delete({ enrollmentId, sessionOn });
    return { ok: true as const };
  }

  /** Нэг оролтын дэлгэрэнгүй — хэн ирсэн, хэн ирээгүй. */
  async sessionDetail(courseId: string, on: string) {
    const list = await this.listEnrollments(courseId);
    const rows = await this.attendance.query<
      { enrollment_id: string; created_at: Date }[]
    >(
      `SELECT a.enrollment_id, a.created_at
         FROM yoga_attendance a
         JOIN yoga_enrollments e ON e.id = a.enrollment_id
        WHERE e.course_id = $1 AND a.session_on = $2`,
      [courseId, on],
    );
    const seen = new Map(rows.map((r) => [r.enrollment_id, r.created_at]));
    return {
      on,
      present: list.filter((e) => seen.has(e.id)).length,
      total: list.length,
      people: list.map((e) => ({
        ...e,
        here: seen.has(e.id),
        at: seen.get(e.id) ?? null,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════

  async summary() {
    const today = this.today;
    const [row] = await this.ds.query<
      { courses: string; enrolled: string; due: string; paid: string }[]
    >(
      `SELECT
         (SELECT count(*) FROM yoga_courses
           WHERE archived_at IS NULL AND ends_on >= $1) AS courses,
         count(e.*)                                     AS enrolled,
         coalesce(sum(e.amount_due), 0)                 AS due,
         coalesce(sum(e.amount_paid), 0)                AS paid
       FROM yoga_enrollments e
       JOIN yoga_courses c ON c.id = e.course_id
      WHERE c.archived_at IS NULL AND c.ends_on >= $1`,
      [today],
    );
    const due = Number(row?.due ?? 0);
    const paid = Number(row?.paid ?? 0);
    return {
      courses: Number(row?.courses ?? 0),
      enrolled: Number(row?.enrolled ?? 0),
      paid,
      owed: Math.max(0, due - paid),
    };
  }

  // ── Дотоод ──

  /** Анги тус бүрийн тоог НЭГ асуулгаар — мөр бүрд асуувал N+1. */
  private async statsFor(ids: string[]) {
    const rows = await this.enrollments.query<
      { course_id: string; enrolled: string; due: string; paid: string }[]
    >(
      `SELECT course_id, count(*) AS enrolled,
              coalesce(sum(amount_due), 0)  AS due,
              coalesce(sum(amount_paid), 0) AS paid
         FROM yoga_enrollments
        WHERE course_id = ANY($1)
        GROUP BY course_id`,
      [ids],
    );
    return new Map(
      rows.map((r) => [
        r.course_id,
        {
          enrolled: Number(r.enrolled),
          due: Number(r.due),
          paid: Number(r.paid),
        },
      ]),
    );
  }

  private view(
    c: YogaCourse,
    s?: { enrolled: number; due: number; paid: number },
  ): YogaCourseView {
    const today = this.today;
    const due = s?.due ?? 0;
    const paid = s?.paid ?? 0;
    return {
      id: c.id,
      name: c.name,
      instructor: c.instructor,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      weekdays: c.weekdays ?? [],
      startTime: c.startTime,
      durationMin: c.durationMin,
      capacity: c.capacity,
      price: Number(c.price),
      note: c.note,
      archivedAt: c.archivedAt,
      state: courseState(c, today),
      sessions: courseSessions(c).length,
      nextOn: nextSession(c, today),
      enrolled: s?.enrolled ?? 0,
      due,
      paid,
      owed: Math.max(0, due - paid),
    };
  }
}
