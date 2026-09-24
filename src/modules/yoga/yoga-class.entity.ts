import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Йогийн нэг хичээл.
 *
 * ⚠ Давтагдах хуваарийг ЭНД хадгалахгүй. Ангиуд нь бодит МӨР болж
 * үүснэ («7 хоног × 8» гэх мэтээр олноор нь үүсгэнэ). Дүрмээр
 * хадгалвал нэг өдрийн хичээлийг цуцлах, багшийг нь солих, оролцогч
 * хавсаргах боломжгүй болно.
 */
@Entity('yoga_classes')
export class YogaClass {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  /** Гаднаас ирдэг багш WinFit-д хэрэглэгч байхгүй тул зүгээр текст. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  instructor: string | null;

  @Index()
  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'duration_min', type: 'int', default: 60 })
  durationMin: number;

  /** `null` = хязгааргүй. */
  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  /** Нэг хүний ердийн төлбөр — бүртгэх бүрд өөрчилж болно. */
  @Column({ type: 'bigint', default: 0 })
  price: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  /** Цуцалсан анги. ⚠ УСТГАХГҮЙ — төлсөн хүмүүсийн бүртгэл үлдэнэ. */
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
