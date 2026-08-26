import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { InvoiceStatus } from '../../common/enums/member-status.enum';

/**
 * Гишүүний төлбөрийн нэхэмжлэх.
 *
 * Нэг гишүүнд нэг зэрэг НЭГ л `pending` нэхэмжлэх байна — дахин дарвал байгааг
 * буцаана (docs/01-integration-model.md §6.6). Ингэснээр Bonum дээр хогийн
 * нэхэмжлэх овоорохгүй.
 */
@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('ix_invoices_member')
  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ name: 'package_id', type: 'uuid' })
  packageId: string;

  /** Багцын нэрийг тухайн үеийн байдлаар хуулбарлана. */
  @Column({ name: 'package_name', type: 'varchar', length: 120 })
  packageName: string;

  @Column({ type: 'int' })
  days: number;

  @Column({ type: 'bigint' })
  amount: string;

  @Index('ix_invoices_status')
  @Column({ type: 'varchar', length: 12, default: InvoiceStatus.PENDING })
  status: InvoiceStatus;

  @Column({ type: 'varchar', length: 20, default: 'bonum' })
  provider: string;

  /** БИДНИЙ талын дугаар — Bonum рүү илгээж, webhook-д буцаж ирнэ. */
  @Index('uq_invoices_txn', { unique: true })
  @Column({ name: 'transaction_id', type: 'varchar', length: 64 })
  transactionId: string;

  @Column({ name: 'provider_invoice_id', type: 'varchar', length: 120, nullable: true })
  providerInvoiceId: string | null;

  /** Гишүүнийг чиглүүлэх төлбөрийн хуудас (`followUpLink`). */
  @Column({ name: 'pay_url', type: 'varchar', length: 1024, nullable: true })
  payUrl: string | null;

  /** Webhook-ийн бүтэн payload — тулгалт, оношлогоонд. */
  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, unknown> | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** Хэн үүсгэсэн (ажилтан) — гишүүн өөрөө үүсгэвэл `null`. */
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
