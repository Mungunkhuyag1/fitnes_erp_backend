import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { Member } from '../member/member.entity';
import {
  CreateYogaBookingDto,
  CreateYogaClassDto,
  ListYogaClassesDto,
  UpdateYogaBookingDto,
  UpdateYogaClassDto,
} from './dto/yoga.dto';
import { YogaBooking } from './yoga-booking.entity';
import { YogaClass } from './yoga-class.entity';

export interface YogaClassView {
  id: string;
  title: string;
  instructor: string | null;
  startsAt: Date;
  durationMin: number;
  capacity: number | null;
  price: number;
  note: string | null;
  cancelledAt: Date | null;
  /** Бүртгүүлсэн хүний тоо. */
  booked: number;
  /** Ирсэн гэж тэмдэглэгдсэн. */
  attended: number;
  /** Хүлээн авсан мөнгө. */
  paid: number;
  /** Бүртгүүлсэн ч мөнгө нь ирээгүй. */
  owed: number;
}

/**
 * Йогийн анги ба оролцогчид.
 *
 * ★ ФИТНЕСЭЭС БҮРЭН ТУСДАА
 *
 * Энэ модуль `memberships`, `access_events`, терминал, outbox аль нэгд
 * нь ХҮРДЭГГҮЙ. Йог нь:
 *
 *   • Хугацаагаар БИШ, ХИЧЭЭЛЭЭР зарагдана
 *   • Оролцогч нь WinFit-ийн гишүүн байх албагүй
 *   • Хаалгыг админ ӨӨРӨӨ нээж өгдөг — терминал оролцохгүй
 *
 * ⚠ Йогийн мөнгийг заалны орлогод НЭМЭХГҮЙ. Захиалагч тусдаа тооцоо
 * хүссэн; нэгтгэвэл аль үйлчилгээ хэр ашигтайг ялгах боломжгүй болно.
 */
@Injectable()
export class YogaService {
  private readonly log = new Logger(YogaService.name);

  constructor(
    @InjectRepository(YogaClass)
    private readonly classes: Repository<YogaClass>,
    @InjectRepository(YogaBooking)
    private readonly bookings: Repository<YogaBooking>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
  ) {}

  // ══════════════════════════════════════════════════════════════
  //  Анги
  // ══════════════════════════════════════════════════════════════

  /**
   * Хичээл үүсгэх. `repeatWeeks > 1` бол 7 хоног тутам давтана.
   *
   * ⚠ Давталтыг ДҮРМЭЭР биш, бодит МӨРӨӨР үүсгэнэ. Дүрмээр хадгалбал
   * нэг өдрийн хичээлийг цуцлах, багшийг нь солих, оролцогч хавсаргах
   * боломжгүй болно.
   */
  async createClass(dto: CreateYogaClassDto): Promise<YogaClassView[]> {
    const weeks = dto.repeatWeeks ?? 1;
    const first = new Date(dto.startsAt);
    if (Number.isNaN(first.getTime())) {
      throw new BadRequestException('Огноо буруу байна');
    }

    const rows: YogaClass[] = [];
    for (let i = 0; i < weeks; i++) {
      const startsAt = new Date(first.getTime() + i * 7 * 86_400_000);
      rows.push(
        this.classes.create({
          title: dto.title.trim(),
          instructor: dto.instructor?.trim() || null,
          startsAt,
          durationMin: dto.durationMin ?? 60,
          capacity: dto.capacity ?? null,
          price: String(dto.price ?? 0),
          note: dto.note?.trim() || null,
        }),
      );
    }
    const saved = await this.classes.save(rows);
    this.log.log(`Йогийн хичээл үүсгэв: ${dto.title} × ${saved.length}`);
    // Шинэ анги хоосон тул тоолох хэрэггүй — тэглэж буцаана.
    return saved.map((c) => this.view(c, { booked: 0, attended: 0, paid: 0, owed: 0 }));
  }

  async listClasses(q: ListYogaClassesDto): Promise<YogaClassView[]> {
    /*
     * Анхдагчаар ӨНӨӨДРӨӨС хойш 30 хоног. Бүх түүхийг нэг дор татвал
     * жилийн дараа хуудас хэдэн зуун мөртэй болно.
     */
    const from = q.from ? new Date(q.from) : startOfToday();
    const to = q.to
      ? new Date(q.to)
      : new Date(from.getTime() + 30 * 86_400_000);

    const rows = await this.classes.find({
      where: {
        startsAt: Between(from, to),
        ...(q.includeCancelled ? {} : { cancelledAt: IsNull() }),
      },
      order: { startsAt: 'ASC' },
    });
    if (!rows.length) return [];

    const stats = await this.statsFor(rows.map((r) => r.id));
    return rows.map((c) => this.view(c, stats.get(c.id)));
  }

  async getClass(id: string): Promise<YogaClassView> {
    const c = await this.classes.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Хичээл олдсонгүй');
    const stats = await this.statsFor([id]);
    return this.view(c, stats.get(id));
  }

  async updateClass(id: string, dto: UpdateYogaClassDto): Promise<YogaClassView> {
    const c = await this.classes.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Хичээл олдсонгүй');

    if (dto.title !== undefined) c.title = dto.title.trim();
    if (dto.instructor !== undefined) c.instructor = dto.instructor.trim() || null;
    if (dto.startsAt !== undefined) c.startsAt = new Date(dto.startsAt);
    if (dto.durationMin !== undefined) c.durationMin = dto.durationMin;
    if (dto.capacity !== undefined) c.capacity = dto.capacity;
    if (dto.price !== undefined) c.price = String(dto.price);
    if (dto.note !== undefined) c.note = dto.note.trim() || null;
    if (dto.cancelled !== undefined) {
      c.cancelledAt = dto.cancelled ? new Date() : null;
    }

    await this.classes.save(c);
    return this.getClass(id);
  }

  /**
   * Хичээл устгах.
   *
   * ⚠ Оролцогчтой болсон хичээлийг УСТГАХГҮЙ — төлбөрийн бүртгэл
   * алга болно. Оронд нь ЦУЦЛАХ (`cancelled`) — мөр нь үлдэж, хэн
   * хэдийг төлсөн нь харагдсаар байна.
   */
  async deleteClass(id: string): Promise<{ ok: true }> {
    const n = await this.bookings.count({ where: { classId: id } });
    if (n > 0) {
      throw new ConflictException(
        `${n} хүн бүртгүүлсэн байна — устгах биш ЦУЦЛАНА уу ` +
          '(төлбөрийн бүртгэл хадгалагдана).',
      );
    }
    const r = await this.classes.delete(id);
    if (!r.affected) throw new NotFoundException('Хичээл олдсонгүй');
    return { ok: true as const };
  }

  // ══════════════════════════════════════════════════════════════
  //  Оролцогч
  // ══════════════════════════════════════════════════════════════

  async listBookings(classId: string) {
    const rows = await this.bookings.find({
      where: { classId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((b) => ({
      id: b.id,
      memberId: b.memberId,
      name: b.name,
      phone: b.phone,
      amount: Number(b.amount),
      paidAt: b.paidAt,
      attendedAt: b.attendedAt,
      note: b.note,
      createdAt: b.createdAt,
    }));
  }

  async addBooking(
    classId: string,
    dto: CreateYogaBookingDto,
    staffUserId: string,
  ) {
    const c = await this.classes.findOne({ where: { id: classId } });
    if (!c) throw new NotFoundException('Хичээл олдсонгүй');
    if (c.cancelledAt) {
      throw new BadRequestException('Цуцалсан хичээлд бүртгэхгүй');
    }

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

      const dup = await this.bookings.findOne({
        where: { classId, memberId: dto.memberId },
      });
      if (dup) throw new ConflictException('Энэ гишүүн аль хэдийн бүртгэгдсэн');
    }
    if (!name) {
      throw new BadRequestException('Нэр эсвэл гишүүнийг заана уу');
    }

    if (c.capacity !== null) {
      const n = await this.bookings.count({ where: { classId } });
      if (n >= c.capacity) {
        throw new ConflictException(
          `Хичээл дүүрсэн (${c.capacity} хүн). Багтаамжийг нэмэгдүүлнэ үү.`,
        );
      }
    }

    const amount = dto.amount ?? Number(c.price);
    const saved = await this.bookings.save(
      this.bookings.create({
        classId,
        memberId: dto.memberId ?? null,
        name,
        phone,
        amount: String(amount),
        // `payLater` → авлага. Гишүүнчлэлтэй ижил дүрэм.
        paidAt: dto.payLater ? null : new Date(),
        note: dto.note?.trim() || null,
        staffUserId,
      }),
    );
    this.log.log(`Йог: ${name} → ${c.title} (${amount}₮)`);
    return saved;
  }

  async updateBooking(id: string, dto: UpdateYogaBookingDto) {
    const b = await this.bookings.findOne({ where: { id } });
    if (!b) throw new NotFoundException('Бүртгэл олдсонгүй');

    if (dto.name !== undefined) b.name = dto.name.trim();
    if (dto.phone !== undefined) b.phone = dto.phone.trim() || null;
    if (dto.amount !== undefined) b.amount = String(dto.amount);
    if (dto.note !== undefined) b.note = dto.note.trim() || null;
    /*
     * ⚠ Аль хэдийн төлөгдсөнийг ДАХИН тэмдэглэвэл анхны огноог нь
     * ХЭВЭЭР үлдээнэ — кассын тайлан дээр огноо үсрэх ёсгүй.
     */
    if (dto.paid !== undefined) {
      b.paidAt = dto.paid ? (b.paidAt ?? new Date()) : null;
    }
    if (dto.attended !== undefined) {
      b.attendedAt = dto.attended ? (b.attendedAt ?? new Date()) : null;
    }

    await this.bookings.save(b);
    return b;
  }

  async removeBooking(id: string): Promise<{ ok: true }> {
    const r = await this.bookings.delete(id);
    if (!r.affected) throw new NotFoundException('Бүртгэл олдсонгүй');
    return { ok: true as const };
  }

  // ══════════════════════════════════════════════════════════════
  //  Товч тоо
  // ══════════════════════════════════════════════════════════════

  /**
   * Заасан хугацааны нэгтгэл — йогийн дэлгэцийн дээд хэсэгт.
   *
   * ⚠ Заалны орлоготой НЭГТГЭХГҮЙ. Захиалагч тусдаа тооцоо хүссэн;
   * нэгтгэвэл аль үйлчилгээ хэр ашигтайг ялгах боломжгүй болно.
   */
  async summary(from?: string, to?: string) {
    const start = from ? new Date(from) : startOfToday();
    const end = to ? new Date(to) : new Date(start.getTime() + 30 * 86_400_000);

    const [row] = await this.bookings.query<
      {
        classes: string;
        bookings: string;
        attended: string;
        paid: string;
        owed: string;
      }[]
    >(
      `SELECT
         (SELECT count(*) FROM yoga_classes
           WHERE cancelled_at IS NULL AND starts_at BETWEEN $1 AND $2) AS classes,
         count(b.*)                                            AS bookings,
         count(*) FILTER (WHERE b.attended_at IS NOT NULL)      AS attended,
         coalesce(sum(b.amount) FILTER (WHERE b.paid_at IS NOT NULL), 0) AS paid,
         coalesce(sum(b.amount) FILTER (WHERE b.paid_at IS NULL), 0)     AS owed
       FROM yoga_bookings b
       JOIN yoga_classes c ON c.id = b.class_id
      WHERE c.cancelled_at IS NULL AND c.starts_at BETWEEN $1 AND $2`,
      [start, end],
    );
    return {
      range: { from: start, to: end },
      classes: Number(row?.classes ?? 0),
      bookings: Number(row?.bookings ?? 0),
      attended: Number(row?.attended ?? 0),
      paid: Number(row?.paid ?? 0),
      owed: Number(row?.owed ?? 0),
    };
  }

  // ── Дотоод ──

  /** Хичээл тус бүрийн тоог НЭГ асуулгаар — мөр бүрд асуувал N+1. */
  private async statsFor(ids: string[]) {
    const rows = await this.bookings.query<
      {
        class_id: string;
        booked: string;
        attended: string;
        paid: string;
        owed: string;
      }[]
    >(
      `SELECT class_id,
              count(*)                                          AS booked,
              count(*) FILTER (WHERE attended_at IS NOT NULL)    AS attended,
              coalesce(sum(amount) FILTER (WHERE paid_at IS NOT NULL), 0) AS paid,
              coalesce(sum(amount) FILTER (WHERE paid_at IS NULL), 0)     AS owed
         FROM yoga_bookings
        WHERE class_id = ANY($1)
        GROUP BY class_id`,
      [ids],
    );
    return new Map(
      rows.map((r) => [
        r.class_id,
        {
          booked: Number(r.booked),
          attended: Number(r.attended),
          paid: Number(r.paid),
          owed: Number(r.owed),
        },
      ]),
    );
  }

  private view(
    c: YogaClass,
    s?: { booked: number; attended: number; paid: number; owed: number },
  ): YogaClassView {
    return {
      id: c.id,
      title: c.title,
      instructor: c.instructor,
      startsAt: c.startsAt,
      durationMin: c.durationMin,
      capacity: c.capacity,
      price: Number(c.price),
      note: c.note,
      cancelledAt: c.cancelledAt,
      booked: s?.booked ?? 0,
      attended: s?.attended ?? 0,
      paid: s?.paid ?? 0,
      owed: s?.owed ?? 0,
    };
  }
}

/** Өнөөдрийн 00:00 (серверийн бүсээр — жагсаалтын анхдагч хил). */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
