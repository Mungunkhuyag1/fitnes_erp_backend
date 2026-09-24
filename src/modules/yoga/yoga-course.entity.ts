import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Йогийн АНГИ — хугацаатай, гарагтай курс.
 *
 * ⚠ Оролтын өдрүүдийг ЭНД хадгалахгүй. Тэдгээр нь (эхлэх, дуусах,
 * гарагууд) гурвын тооцоолол — `yoga.schedule.ts`. Мөр болгож
 * хадгалбал хуваарь өөрчлөгдөхөд ирцтэй өдрүүд эзэнгүй үлдэнэ.
 */
@Entity('yoga_courses')
export class YogaCourse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Гаднаас ирдэг багш WinFit-д хэрэглэгч байхгүй тул зүгээр текст. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  instructor: string | null;

  /** ⚠ `date` — цаггүй. Бүсийн гулсалт үүсэхгүй. */
  @Column({ name: 'starts_on', type: 'date' })
  startsOn: string;

  @Column({ name: 'ends_on', type: 'date' })
  endsOn: string;

  /** 0 = Ням … 6 = Бямба (JS `getDay()`-тай ижил). */
  @Column({ type: 'smallint', array: true, default: () => "'{}'" })
  weekdays: number[];

  /** Орон нутгийн цаг, `19:00`. */
  @Column({ name: 'start_time', type: 'time', default: '19:00' })
  startTime: string;

  @Column({ name: 'duration_min', type: 'int', default: 60 })
  durationMin: number;

  /** `null` = хязгааргүй. */
  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  /** Нэг хүн БҮТЭН хугацаанд төлөх дүн. */
  @Column({ type: 'bigint', default: 0 })
  price: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  /** Архивлав — жагсаалтаас нуух. ⚠ УСТГАХГҮЙ: төлбөр, ирц үлдэнэ. */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
