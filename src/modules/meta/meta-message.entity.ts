import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type MetaDirection = 'in' | 'out';

/** Messenger-ийн хавсралт — Meta-гийн өгсөн хэлбэрээр хадгална. */
export interface MetaAttachment {
  type: string;
  payload?: { url?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * Нэг мессеж.
 *
 * ⚠ `mid` нь ДАВХАРДЛЫГ ХААХ түлхүүр. Meta нь 200 хариу авахгүй бол
 * webhook-ийг ДАХИН илгээдэг, мөн бидний илгээсэн мессеж
 * `message_echoes`-оор буцаж ирдэг. `ON CONFLICT DO NOTHING` нь
 * хоёуланг нь чимээгүй шүүнэ (`access_events.dedupe_key`-тэй ижил арга).
 */
@Entity('meta_messages')
export class MetaMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('ix_meta_msg_thread')
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Index('uq_meta_mid', { unique: true })
  @Column({ type: 'varchar', length: 200 })
  mid: string;

  @Column({ type: 'varchar', length: 3 })
  direction: MetaDirection;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  text: string | null;

  @Column({ type: 'jsonb', nullable: true })
  attachments: MetaAttachment[] | null;

  /**
   * Хэн хариулсан бэ.
   *
   * `null` = Business Suite эсвэл утаснаас бичсэн. Тийм мессеж
   * `message_echoes`-оор ирдэг бөгөөд Meta хэн бичсэнийг хэлдэггүй.
   */
  @Column({ name: 'staff_user_id', type: 'uuid', nullable: true })
  staffUserId: string | null;

  /**
   * Илгээх үед гарсан алдаа.
   *
   * ⚠ Алдаатай мөрийг УСТГАХГҮЙ. Ажилтан «илгээгдсэнгүй» гэдгийг
   * харах ёстой — чимээгүй алга болвол хариулсан гэж бодно.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  error: string | null;

  /** Meta-гийн өгсөн агшин (webhook дэх `timestamp`). */
  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
