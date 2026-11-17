import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PackageAudience } from '../../common/enums/audience.enum';

/**
 * Гишүүнчлэлийн багц — ХОНОГООР эсвэл ОРОЛТООР.
 *
 *  • `entries = null` → хоногийн багц: хугацаандаа хязгааргүй нэвтэрнэ.
 *  • `entries = N`    → оролтын багц: `days` хоногийн дотор N удаа орно.
 *    Аль нь түрүүлж дуусна, тэр үед эрх хаагдана («2 сард 12 оролт»).
 *
 * Оролт хэрхэн хасагдахыг (уншуулалт бүр / цонх / өдөрт 1) тохиргооны
 * `entry_charge_mode` шийднэ — `EntryChargeService`.
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

  /**
   * Оролтын тоо. `null` = хязгааргүй (хоногийн багц).
   *
   * ⚠ Тоотой үед `days` нь ХҮЧИНТЭЙ ХУГАЦАА болно — оролт үлдсэн ч
   * хугацаа дуусвал эрх хаагдана.
   */
  @Column({ type: 'int', nullable: true })
  entries: number | null;

  /** Үнэ — төгрөгөөр БҮХЭЛ тоо (мөнгөн тэмдэгтгүй). */
  @Column({ type: 'bigint' })
  price: string;

  /**
   * Хэнд зориулсан багц вэ.
   *
   * Ижил хугацаа өөр үнэтэй байдгийг тайлбарладаг цорын ганц талбар:
   * 30 хоног нь энгийн хүнд 250,000₮, оюутанд 160,000₮.
   */
  @Column({ type: 'varchar', length: 20, default: PackageAudience.STANDARD })
  audience: PackageAudience;

  /**
   * Худалдан авахад баримт шалгуулах шаардлагатай эсэх.
   *
   * `true` үед онлайн төлбөр хийгдсэн ч эрх АВТОМАТААР нээгдэхгүй —
   * ресепшн дээр баримт үзүүлж, ажилтан гараар нээнэ.
   */
  @Column({ name: 'requires_proof', type: 'boolean', default: false })
  requiresProof: boolean;

  /** Зөвхөн өмнө нь гишүүнчлэл аваагүй хүнд («анх удаа 188,000₮»). */
  @Column({ name: 'first_time_only', type: 'boolean', default: false })
  firstTimeOnly: boolean;

  /** Хэдэн хүний эрх вэ. Хосын багц = 2, бусад = 1. */
  @Column({ type: 'int', default: 1 })
  seats: number;

  /**
   * Онлайнаар зарагдах уу.
   *
   * Хосын багц `false`: хоёр гишүүнийг зэрэг сонгох нь онлайнд
   * тохирохгүй, ресепшн дээр хоёулаа байгаа тул хормын ажил.
   */
  @Column({ type: 'boolean', default: true })
  online: boolean;

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

  /**
   * Устгагдсан (зарагдсан тул бүрмөсөн устгах боломжгүй) багц.
   *
   * ⚠ `@DeleteDateColumn` БИШ — тэр нь бүх `find`-аас автоматаар хасдаг.
   * Тайлан, төлөгдөөгүй нэхэмжлэх устгасан багцыг ID-аар нь олох ёстой.
   */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
