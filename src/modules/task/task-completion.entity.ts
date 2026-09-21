import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Нэг ажлын НЭГ ӨДРИЙН гүйцэтгэл.
 *
 * Мөр БАЙГАА нь «гүйцэтгэсэн» гэсэн үг. Буцаахад мөрийг устгана —
 * `done: false` гэсэн талбар байхгүй нь зориуд: хоёр эх сурвалж
 * (мөр байгаа эсэх, талбарын утга) зөрөх боломжийг арилгана.
 */
@Entity('task_completions')
@Index('uq_task_completion', ['taskId', 'occurrenceOn'], { unique: true })
export class TaskCompletion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  /** Аль ӨДРИЙН тохиолдол. `YYYY-MM-DD` текст (`date` төрөл). */
  @Column({ name: 'occurrence_on', type: 'date' })
  occurrenceOn: string;

  @Column({ name: 'done_by', type: 'uuid', nullable: true })
  doneBy: string | null;

  @CreateDateColumn({ name: 'done_at', type: 'timestamptz' })
  doneAt: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;
}
