import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Йогийн нэг удаагийн төлбөр.
 *
 * ⚠ `yoga_enrollments.amount_paid` нь эдгээрийн НИЙЛБЭРИЙН кэш.
 * Төлбөр нэмэх бүрд хоёулаа хамт шинэчлэгдэнэ — тайлан нь энэ
 * хүснэгтээс огноогоор нь уншина.
 */
@Entity('yoga_payments')
export class YogaPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'enrollment_id', type: 'uuid' })
  enrollmentId: string;

  @Column({ type: 'bigint' })
  amount: string;

  /** Мөнгө ХЭЗЭЭ орсон — тайлан үүгээр бүлэглэнэ. */
  @Index()
  @Column({ name: 'paid_at', type: 'timestamptz', default: () => 'now()' })
  paidAt: Date;

  @Column({ name: 'staff_user_id', type: 'uuid', nullable: true })
  staffUserId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
