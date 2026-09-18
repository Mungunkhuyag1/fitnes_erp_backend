import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { PromotionKind } from '../promotion/promotion.entity';

/**
 * Нэхэмжлэхэд хэрэглэсэн урамшуулал — нэг мөр = нэг урамшуулал.
 *
 * ★ ЯАГААД ХУУЛБАРЛАЖ ХАДГАЛНА ВЭ
 *
 * `value_applied` нь нэхэмжлэх ҮҮСЭХ агшинд тооцоологдоно. Өмнө нь
 * төлөгдөх агшинд багцын үнээс дахин тооцдог байсан — багцын үнэ
 * завсарт өөрчлөгдвөл статистик буруу тоо бүртгэж байв.
 *
 * ⚠ `invoices.days`/`amount`-тай ижил зарчим: төлсөн хүн амласан
 * хоног, үнээ авна. Урамшуулал дуусах, унтрах, устах нь аль хэдийн
 * үүссэн нэхэмжлэхэд НӨЛӨӨЛӨХГҮЙ.
 */
@Entity('invoice_promotions')
export class InvoicePromotion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'promotion_id', type: 'uuid' })
  promotionId: string;

  @Column({ type: 'varchar', length: 12 })
  kind: PromotionKind;

  /** Хэдэн төгрөг хөнгөлсөн, эсвэл хэдэн хоног нэмсэн. */
  @Column({ name: 'value_applied', type: 'bigint' })
  valueApplied: string;

  /** Хэрэглэсэн дараалал — хязгаарт таслагдсаныг эргэж уншихад. */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
