import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum OutboxStatus {
  PENDING = 'pending',
  DONE = 'done',
  /** Дахин оролдох утгагүй — гараар шийдэх шаардлагатай. */
  FAILED = 'failed',
}

/**
 * Гадаад ертөнц рүү чиглэсэн нөлөөг НАЙДВАРТАЙ хүргэх дараалал.
 *
 * Бизнесийн транзакц дотор зөвхөн ЭНД мөр бичигдэнэ (HTTP дуудлага транзакцын
 * дотор хэзээ ч байхгүй). Worker дараа нь илгээнэ — docs/02-architecture.md §6.
 *
 * Ингэснээр «мөнгө орсон ч терминал руу хүрсэнгүй» гэсэн байдал үүсэхгүй:
 * гүйлгээ амжилттай бол дараалалд орсон нь баталгаатай.
 */
@Entity('outbox')
export class OutboxMessage {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  /** Жишээ: `hik.userUpsert`, `loopy.extend`, `notify.push`. */
  @Column({ type: 'varchar', length: 60 })
  topic: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  /**
   * Дараалал хамгаалах түлхүүр — ихэвчлэн `member:<id>`.
   *
   * Ижил түлхүүртэй мессежүүд ЯГ дарааллаараа, нэг нэгээр боловсруулагдана.
   * Эс тэгвээс «сунга» ба «зогсоо» хоёр солбиж, терминал дээр буруу төлөв
   * үлдэнэ. Өөр түлхүүртэй мессежүүд зэрэг явж болно.
   */
  @Index('ix_outbox_group')
  @Column({ name: 'group_key', type: 'varchar', length: 80, nullable: true })
  groupKey: string | null;

  @Index('ix_outbox_status')
  @Column({ type: 'varchar', length: 12, default: OutboxStatus.PENDING })
  status: OutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** Backoff — энэ хугацаанаас өмнө авахгүй. */
  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt: Date;

  @Column({ name: 'last_error', type: 'varchar', length: 1000, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
