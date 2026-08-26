import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Илгээсэн сануулгын бүртгэл.
 *
 * Нэг гишүүнчлэлийн мөчлөгт нэг цэг дээр НЭГ л удаа сануулна. Гишүүн эрхээ
 * сунгавал шинэ `membership_id` үүсэх тул сануулга дахин эхэлнэ
 * (docs/01-integration-model.md §6.7).
 */
@Entity('reminder_log')
@Index('uq_reminder_once', ['membershipId', 'milestone'], { unique: true })
export class ReminderLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('ix_reminder_member')
  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ name: 'membership_id', type: 'uuid' })
  membershipId: string;

  /** `T-7` | `T-3` | `T-1` | `T0` */
  @Column({ type: 'varchar', length: 8 })
  milestone: string;

  /** Хүлээн авсан төхөөрөмжийн тоо. `0` = картгүй/устгасан → залгах хэрэгтэй. */
  @Column({ type: 'int', default: 0 })
  devices: number;

  @CreateDateColumn({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;
}
