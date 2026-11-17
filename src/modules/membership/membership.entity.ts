import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MembershipSource } from '../../common/enums/member-status.enum';

/**
 * Гишүүнчлэлийн ДЭВТЭР — худалдан авалт бүр НЭГ мөр.
 *
 * `members.access_ends_at` бол энэ дэвтрээс тооцсон кэш. Зөрүү гарвал ҮРГЭЛЖ
 * дэвтэр зөв (docs/02-architecture.md §5.4).
 *
 * Буцаалт хийхэд мөрийг УСТГАХГҮЙ — `reversedAt` тавьж, эрхийг дэвтрээс дахин
 * тооцно. Ингэснээр мөнгөн гүйлгээний түүх бүрэн хэвээр үлдэнэ.
 */
@Entity('memberships')
export class Membership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('ix_memberships_member')
  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  /** Багц устсан/өөрчлөгдсөн ч энэ мөрийн `days`/`amount` хэвээр үлдэнэ. */
  @Column({ name: 'package_id', type: 'uuid', nullable: true })
  packageId: string | null;

  /** Багцын нэрийг тухайн үеийн байдлаар хуулбарлана (түүх зөв харагдана). */
  @Column({ name: 'package_name', type: 'varchar', length: 120, nullable: true })
  packageName: string | null;

  @Column({ type: 'int' })
  days: number;

  /**
   * Олгосон оролтын тоо. `null` = хязгааргүй (хоногийн эрх).
   *
   * ★ ДЭВТРИЙН ДҮРЭМ (`ledger.util.ts`)
   *
   * Мөрүүд дарааллаараа «хэрэглэгдэнэ». Оролтын мөр нь `days` хоног
   * ЭСВЭЛ оролт нь дуусах хүртэл (аль нь түрүүлнэ) идэвхтэй, дараагийн
   * мөр нь тэр агшнаас эхэлнэ.
   */
  @Column({ type: 'int', nullable: true })
  entries: number | null;

  /**
   * Хэдэн оролт хасагдсан бэ — ЗӨВХӨН бүлгийн ТЭРГҮҮН мөр дээр тоологдоно.
   *
   * Хасалт бүр `access_events.entry_membership_id`-д мөн бичигддэг тул
   * энэ нь тэдгээрийн тоотой үргэлж тэнцүү байх ёстой кэш.
   */
  @Column({ name: 'entries_used', type: 'int', default: 0 })
  entriesUsed: number;

  /**
   * Өмнөх оролтын мөрийн ҮРГЭЛЖЛЭЛ үү.
   *
   * Оролтын эрхтэй гишүүнд хоног (чөлөө, гараар) эсвэл нэмэлт оролт
   * өгөхөд шинэ хязгааргүй цонх нээхийн оронд одоогийн оролтын бүлгийн
   * хугацааг/тоог нэмэгдүүлнэ. Эс бөгөөс чөлөөний 7 хоног нь «7 хоног
   * хязгааргүй» болж хувирна.
   */
  @Column({ name: 'joins_previous', type: 'boolean', default: false })
  joinsPrevious: boolean;

  /**
   * Оролт дууссаны улмаас эрх ХААГДСАН агшин (тэргүүн мөр дээр).
   *
   * ⚠ ТОГТМОЛ утга — «сүүлийн хасалт + давтан уншуулах цонх». Тооцоог
   * дуудалт бүрд «одоо»-гоор хийвэл тулгалт мөнхийн зөрүү олно
   * (`cancel()`-ийн тайлбартай ижил шалтгаан).
   */
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'varchar', length: 12 })
  source: MembershipSource;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;

  /** Гараар/бэлнээр бол хэн хийсэн. */
  @Column({ name: 'staff_user_id', type: 'uuid', nullable: true })
  staffUserId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  /** Энэ худалдан авалтын үр дүнд эрх хэзээ хүртэл болсон. */
  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  /** Давхар сунгахаас хамгаална — сүлжээ тасарч дахин илгээгдсэн ч нэг л удаа. */
  @Index('uq_memberships_idem', { unique: true })
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  /**
   * Мөнгө ХЭЗЭЭ ирсэн бэ. `null` = хараахан аваагүй (авлага).
   *
   * ⚠ Эрхийг ТӨЛБӨРӨӨС салгана: гишүүн зааланд шууд орно, мөнгө нь
   * хожим бүртгэгдэнэ. Тайлан дээр орлогыг энэ огноогоор тооцно —
   * `created_at`-аар биш, эс бөгөөс аваагүй мөнгө орлогод орно.
   */
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt: Date | null;

  @Column({ name: 'reversed_by', type: 'uuid', nullable: true })
  reversedBy: string | null;

  @Column({ name: 'reverse_reason', type: 'varchar', length: 500, nullable: true })
  reverseReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
