import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Нэг хичээл дээрх нэг оролцогч. */
@Entity('yoga_bookings')
export class YogaBooking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'class_id', type: 'uuid' })
  classId: string;

  /**
   * ⚠ ЗААВАЛ БИШ. Йогт заалны гишүүн биш хүн ирж болно.
   */
  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  /**
   * Нэрийг ҮРГЭЛЖ хадгална — гишүүнтэй холбогдсон ч гэсэн.
   *
   * ⚠ Гишүүн уствал (`ON DELETE SET NULL`) энэ мөр хэний болох нь
   * мэдэгдэхгүй болох ёсгүй.
   */
  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string | null;

  @Column({ type: 'bigint', default: 0 })
  amount: string;

  /** `null` = мөнгө аваагүй (авлага). Гишүүнчлэлтэй ижил дүрэм. */
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  /** Ирсэн эсэх — хичээл болсны дараа админ тэмдэглэнэ. */
  @Column({ name: 'attended_at', type: 'timestamptz', nullable: true })
  attendedAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ name: 'staff_user_id', type: 'uuid', nullable: true })
  staffUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
