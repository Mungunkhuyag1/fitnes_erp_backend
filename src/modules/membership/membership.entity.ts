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

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt: Date | null;

  @Column({ name: 'reversed_by', type: 'uuid', nullable: true })
  reversedBy: string | null;

  @Column({ name: 'reverse_reason', type: 'varchar', length: 500, nullable: true })
  reverseReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
