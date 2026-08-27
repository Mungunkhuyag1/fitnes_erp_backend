import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Сануулга юуны тухай вэ. */
export enum ReminderKind {
  MEMBERSHIP = 'membership',
  LOCKER = 'locker',
}

/**
 * Илгээсэн сануулгын бүртгэл.
 *
 * Нэг МӨЧЛӨГТ нэг цэг дээр НЭГ л удаа сануулна:
 *   · гишүүнчлэл — `membership_id`. Сунгавал шинэ мөр үүсэх тул
 *     сануулга дахин эхэлнэ (docs/01-integration-model.md §6.7).
 *   · шүүгээ     — `locker_assignment_id`. Шинэ түрээс = шинэ мөчлөг.
 *
 * ⚠ Хоёр төрөл ТУСДАА unique индекстэй. Нэг баганад хоёуланг нь
 * шахвал багана нэрээ хуурч, дараагийн хүн эндүүрнэ.
 */
@Entity('reminder_log')
export class ReminderLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('ix_reminder_member')
  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({
    name: 'kind',
    type: 'varchar',
    length: 12,
    default: ReminderKind.MEMBERSHIP,
  })
  kind: ReminderKind;

  /** `kind = membership` үед бөглөгдөнө. */
  @Column({ name: 'membership_id', type: 'uuid', nullable: true })
  membershipId: string | null;

  /** `kind = locker` үед бөглөгдөнө. */
  @Column({ name: 'locker_assignment_id', type: 'uuid', nullable: true })
  lockerAssignmentId: string | null;

  /** `T-7` | `T-3` | `T-1` | `T0` */
  @Column({ type: 'varchar', length: 8 })
  milestone: string;

  /** Хүлээн авсан төхөөрөмжийн тоо. `0` = картгүй/устгасан → залгах хэрэгтэй. */
  @Column({ type: 'int', default: 0 })
  devices: number;

  @CreateDateColumn({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;
}
