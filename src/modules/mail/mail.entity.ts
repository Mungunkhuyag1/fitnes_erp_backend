import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Ямар мэдэгдэл авахыг сонгоно. */
export enum MailEvent {
  /** Өдрийн орлогын хураангуй — 23:00. */
  DAILY_INCOME = 'daily_income',
  /**
   * Төлбөр орсон — тэр даруй.
   *
   * `MAIL_LARGE_PAYMENT`-аас ДЭЭШ дүнд л явна. Хязгаарыг 0 болговол
   * төлбөр бүрд явна — гэхдээ өдөрт 10 төлбөр байвал сард 300 мэйл
   * болно гэдгийг санаарай.
   */
  LARGE_PAYMENT = 'large_payment',
  /** Терминалын синк бүтэлгүйтсэн — тэр даруй. */
  SYNC_FAILED = 'sync_failed',
}

export const MAIL_EVENT_LABEL: Record<MailEvent, string> = {
  [MailEvent.DAILY_INCOME]: 'Өдрийн орлогын хураангуй',
  [MailEvent.LARGE_PAYMENT]: 'Төлбөр орсон',
  [MailEvent.SYNC_FAILED]: 'Синк бүтэлгүйтсэн',
};

/**
 * Мэдэгдэл хүлээн авагч.
 *
 * ⚠ Хаягийг `.env`-д БИШ DB-д хадгална: заалны эзэн хүн нэмэх/хасахад
 * deploy хүлээх ёсгүй.
 */
@Entity('notification_recipients')
export class NotificationRecipient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  email: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name: string | null;

  /** Хоосон бол ЮУ Ч авахгүй — «бүгд» гэсэн утга биш. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  events: MailEvent[];

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/** Илгээсэн мэйлийн бүртгэл — «явсан уу» гэдгийг хойно нь шалгах. */
@Entity('email_log')
export class EmailLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'to_email', type: 'varchar', length: 160 })
  toEmail: string;

  @Column({ type: 'varchar', length: 300 })
  subject: string;

  @Column({ type: 'varchar', length: 40 })
  template: string;

  /** `sent` | `failed` | `stub` */
  @Column({ type: 'varchar', length: 12 })
  status: string;

  @Column({ name: 'provider_id', type: 'varchar', length: 120, nullable: true })
  providerId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error: string | null;

  @Index('ix_email_log_sent')
  @CreateDateColumn({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;
}
