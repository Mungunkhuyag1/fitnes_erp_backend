import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Нэг хүн нэг ӨДӨР ирсэн гэсэн бичлэг.
 *
 * ⚠ Хичээлийн мөрөөр биш ӨДРӨӨР холбогдоно. Ангийн хуваарь
 * өөрчлөгдсөн ч бүртгэгдсэн ирц эзэнгүй үлдэхгүй.
 */
@Entity('yoga_attendance')
export class YogaAttendance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'enrollment_id', type: 'uuid' })
  enrollmentId: string;

  /** `YYYY-MM-DD` — цаггүй. */
  @Column({ name: 'session_on', type: 'date' })
  sessionOn: string;

  @Column({ name: 'staff_user_id', type: 'uuid', nullable: true })
  staffUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
