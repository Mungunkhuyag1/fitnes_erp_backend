import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Гишүүнчлэлийн багц — ЗӨВХӨН хугацаа (хоног).
 *
 * Цагийн хязгаар ч, оролт тоолох ч байхгүй: эрхтэй гишүүн хэзээ ч нэвтэрнэ
 * (docs/01-integration-model.md §6.9, шийдвэр 9).
 */
@Entity('packages')
export class Package {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Хэдэн хоногийн эрх олгох. */
  @Column({ type: 'int' })
  days: number;

  /** Үнэ — төгрөгөөр БҮХЭЛ тоо (мөнгөн тэмдэгтгүй). */
  @Column({ type: 'bigint' })
  price: string;

  /**
   * Устгахын оронд идэвхгүй болгоно — түүхэн `memberships` мөрүүд багцын
   * нэрийг заасаар байх ёстой.
   */
  @Index('ix_packages_active')
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Жагсаалтад харагдах дараалал (бага нь эхэнд). */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
