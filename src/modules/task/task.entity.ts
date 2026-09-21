import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Давталтын төрөл. */
export enum TaskKind {
  ONCE = 'once',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  [TaskKind.ONCE]: 'Нэг удаа',
  [TaskKind.DAILY]: 'Өдөр бүр',
  [TaskKind.WEEKLY]: '7 хоног бүр',
  [TaskKind.MONTHLY]: 'Сар бүр',
};

/**
 * Төлөвлөгөөт ажлын ДҮРЭМ.
 *
 * ⚠ Энэ нь «нэг ажил» биш, «ажил хэзээ давтагдахыг тодорхойлсон дүрэм».
 * Тодорхой өдрийн тохиолдлууд нь ХАДГАЛАГДДАГГҮЙ — дүрмээс тооцогдоно
 * (`task.expand.ts`). Гүйцэтгэсэн тэмдэглэгээ л хадгалагдана
 * (`TaskCompletion`).
 */
@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 10, default: TaskKind.ONCE })
  kind: TaskKind;

  /**
   * Бүх давталтын ТУЛГУУР огноо — `YYYY-MM-DD`.
   *
   * ⚠ `date` төрөл тул TypeORM түүнийг ТЕКСТЭЭР өгдөг, `Date` объект
   * БИШ. Хуанлийн өдөр нь цаг бүсээс хамаарах ёсгүй тул энэ нь зөв:
   * `Date` болговол UB (UTC+8) дээр өглөө бүр нэг өдрөөр гулсана.
   */
  @Index('ix_tasks_active')
  @Column({ name: 'starts_on', type: 'date' })
  startsOn: string;

  /** `HH:MM:SS` эсвэл `null`. Зөвхөн харуулахад — сануулга илгээдэггүй. */
  @Column({ name: 'at_time', type: 'time', nullable: true })
  atTime: string | null;

  @Column({ name: 'ends_on', type: 'date', nullable: true })
  endsOn: string | null;

  /**
   * Хэн хийх ёстой. `null` = хэн ч — бүх ажилтны жагсаалтад харагдана.
   */
  @Index('ix_tasks_assignee')
  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId: string | null;

  /**
   * ⚠ УСТГАХЫН ОРОНД унтраана.
   *
   * Давтагдах ажлыг устгавал өнгөрсөн өдрүүдийн гүйцэтгэл ч хамт
   * (`ON DELETE CASCADE`) арилна — тайлан, түүх нь худлаа болно.
   */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
