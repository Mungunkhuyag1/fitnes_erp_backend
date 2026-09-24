import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Нэг ангид бүртгүүлсэн хүн. */
@Entity('yoga_enrollments')
export class YogaEnrollment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'course_id', type: 'uuid' })
  courseId: string;

  /** ⚠ ЗААВАЛ БИШ — йогт заалны гишүүн биш хүн ирж болно. */
  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  /**
   * Нэрийг ҮРГЭЛЖ хадгална.
   *
   * ⚠ Гишүүн уствал (`ON DELETE SET NULL`) энэ мөр хэний болох нь
   * мэдэгдэхгүй болох ёсгүй.
   */
  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string | null;

  /**
   * ★ ТӨЛБӨРИЙГ ХОЁР ТАЛБАРААР
   *
   * Йогийн төлбөр ХЭСЭГЧИЛЖ ордог тул ганц «төлсөн үү» тугаар
   * илэрхийлэх боломжгүй. Үлдэгдэл = `amountDue − amountPaid`.
   */
  @Column({ name: 'amount_due', type: 'bigint', default: 0 })
  amountDue: string;

  @Column({ name: 'amount_paid', type: 'bigint', default: 0 })
  amountPaid: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ name: 'staff_user_id', type: 'uuid', nullable: true })
  staffUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
