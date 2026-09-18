import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum PromotionKind {
  /** Хувиар хөнгөлнө — `value` = 20 бол 20%. */
  PERCENT = 'percent',
  /** Дүнгээр хөнгөлнө — `value` = 50000 бол −50,000₮. */
  AMOUNT = 'amount',
  /** Тогтмол үнэ — багцын үнийг `value` болгоно. */
  FIXED_PRICE = 'fixed_price',
  /** Хоног нэмнэ — үнэ хэвээр, `value` хоног нэмэгдэнэ. */
  BONUS_DAYS = 'bonus_days',
}

export const PROMOTION_KIND_LABEL: Record<PromotionKind, string> = {
  [PromotionKind.PERCENT]: 'Хувиар хөнгөлөх',
  [PromotionKind.AMOUNT]: 'Дүнгээр хөнгөлөх',
  [PromotionKind.FIXED_PRICE]: 'Тогтмол үнэ',
  [PromotionKind.BONUS_DAYS]: 'Хоног нэмэх',
};

export enum PromotionChannel {
  ONLINE = 'online',
  RECEPTION = 'reception',
}

@Entity('promotions')
export class Promotion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 12 })
  kind: PromotionKind;

  @Column({ type: 'bigint' })
  value: string;

  /** Хоосон = БҮХ багцад. */
  @Column({ name: 'package_ids', type: 'uuid', array: true, default: () => "'{}'" })
  packageIds: string[];

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  /** Зарим урамшуулал зөвхөн ресепшнд утга учиртай. */
  @Column({ type: 'text', array: true, default: () => "'{online,reception}'" })
  channels: PromotionChannel[];

  /**
   * Давхарлахыг зогсоох уу.
   *
   * Онцгой урамшуулал тохирвол бусад нь тооцогдохгүй — зөвхөн тэр
   * үйлчилнэ. Хэд хэдэн онцгой урамшуулал зэрэг тохирвол `sortOrder`
   * их нь (тэнцвэл эрт үүссэн нь) ялна.
   *
   * ⚠ `fixed_price` нь ҮРГЭЛЖ онцгой — DB дээр `CK` барина. «Үнэ нь
   * 500,000₮» гэж зарлаад дээрээс нь дахин хямдруулах нь өөрийгөө
   * няцаана.
   */
  @Column({ type: 'boolean', default: false })
  exclusive: boolean;

  /**
   * Давхарлах дараалал — ИХ нь түрүүлж хэрэглэгдэнэ.
   *
   * Нийт хөнгөлөлт хязгаарт хүрэхэд үлдсэн урамшуулал таслагдах тул
   * дараалал нь «аль нь бүтнээрээ орох вэ» гэдгийг шийднэ.
   */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /**
   * Идэвхтэй эсэх.
   *
   * ⚠ Олон урамшуулал зэрэг идэвхтэй байж БОЛНО (1788130000000). Энэ нь
   * «үйлчилж байна» гэсэн үг БИШ: хугацааны цонх, суваг, багц гурвуулаа
   * таарсан үед л `quote()` хэрэглэнэ.
   */
  @Index('ix_promotion_active', { where: '"active"' })
  @Column({ type: 'boolean', default: false })
  active: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/**
 * Ашиглалтын бүртгэл.
 *
 * ⚠ Зөвхөн тоолуур барих нь ХАНГАЛТГҮЙ: «энэ урамшууллаар хэдэн хүн
 * ирсэн, хэдэн төгрөг хөнгөлсөн» гэдгийг хэлж чадахгүй. Урамшуулал
 * ажилласан эсэхийг хэмжихгүй бол дараагийн шийдвэрийг таамгаар гаргана.
 */
@Entity('promotion_redemptions')
export class PromotionRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'promotion_id', type: 'uuid' })
  promotionId: string;

  @Column({ name: 'membership_id', type: 'uuid', nullable: true })
  membershipId: string | null;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;

  @Column({ type: 'varchar', length: 12 })
  kind: PromotionKind;

  /** Хэдэн төгрөг хөнгөлсөн, эсвэл хэдэн хоног нэмсэн. */
  @Column({ name: 'value_applied', type: 'bigint' })
  valueApplied: string;

  @CreateDateColumn({ name: 'redeemed_at', type: 'timestamptz' })
  redeemedAt: Date;
}
