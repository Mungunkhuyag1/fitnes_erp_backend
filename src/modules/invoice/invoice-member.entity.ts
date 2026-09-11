import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Нэхэмжлэхэд хамаарах нэмэлт гишүүн (хосын багц).
 *
 * ⚠ Зөвхөн `seats > 1` багцад үүснэ. Энгийн багцад `invoices.member_id`
 * л ажиллана — бүх хуучин код хэвээр.
 */
@Entity('invoice_members')
export class InvoiceMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  /** 1 = төлсөн хүн, 2 = хамтрагч. */
  @Column({ name: 'seat_no', type: 'int' })
  seatNo: number;
}
