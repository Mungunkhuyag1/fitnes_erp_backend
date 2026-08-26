import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Хувцас солих өрөөний шүүгээ.
 *
 * ⚠ ЭРЭГТЭЙ ба ЭМЭГТЭЙ өрөөний дугаарлалт ТУСДАА — хоёр өрөөнд хоёулаа «42»
 * дугаартай шүүгээ байна. Тиймээс өвөрмөц түлхүүр нь `(zone, number)` ХОС.
 * Дугаар дангаараа хэзээ ч хангалттай биш.
 *
 * Урьдчилан бүртгэх шаардлагагүй: түлхүүр олгох үед тухайн (өрөө, дугаар)
 * байхгүй бол АВТОМАТААР үүснэ. Систем нэвтрүүлэхэд «эхлээд 200 шүүгээ
 * бүртгэ» гэсэн саад гарахгүй.
 */
@Entity('lockers')
@Index('uq_lockers_zone_number', ['zone', 'number'], { unique: true })
export class Locker {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Хувцас солих өрөө: «Эрэгтэй», «Эмэгтэй», цаашид «2 давхар» г.м. */
  @Column({ type: 'varchar', length: 60 })
  zone: string;

  /** Шүүгээний = түлхүүрийн дугаар. Зөвхөн ӨРӨӨНИЙ ДОТОР өвөрмөц. */
  @Column({ type: 'int' })
  number: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  /** Эвдэрсэн/түр хаасан шүүгээ — олгох боломжгүй болно. */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
