import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum LockerAssignmentType {
  /** Өдрийн түлхүүр — гишүүн ирэхэд өгч, явахад буцааж авна. */
  DAILY = 'daily',
  /** Түрээс — сар/улирлаар, төлбөртэй. */
  RENTAL = 'rental',
}

/**
 * Түлхүүр олголт бүр НЭГ мөр.
 *
 * Хоёр хэрэглээг нэг хүснэгтэд нэгтгэсэн шалтгаан: «түлхүүр №42 хэн дээр
 * байна?» гэсэн асуулт нэг л газраас хариулагдах ёстой. Ялгаа нь зөвхөн
 * `type` ба `dueAt` (түрээсийн хугацаа).
 *
 * `returnedAt IS NULL` = түлхүүр ГАРСАН хэвээр.
 */
@Entity('locker_assignments')
export class LockerAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('ix_locker_asg_locker')
  @Column({ name: 'locker_id', type: 'uuid' })
  lockerId: string;

  /**
   * Шүүгээний өрөө ба дугаарыг ХУУЛБАРЛАНА (denormalize).
   *
   * Түүхэн бичлэг дээр «Эрэгтэй №42» гэж харагдах ёстой — шүүгээ дараа нь
   * өөр өрөө рүү шилжсэн ч хуучин олголт зөв хэвээр үлдэнэ. Мөн жагсаалт,
   * хайлтад join шаардахгүй.
   */
  @Column({ name: 'locker_zone', type: 'varchar', length: 60 })
  lockerZone: string;

  @Column({ name: 'locker_number', type: 'int' })
  lockerNumber: number;

  @Index('ix_locker_asg_member')
  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ type: 'varchar', length: 10 })
  type: LockerAssignmentType;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ name: 'issued_by', type: 'uuid', nullable: true })
  issuedBy: string | null;

  /** Түрээсийн дуусах огноо. Өдрийн түлхүүрт `null`. */
  @Index('ix_locker_asg_due')
  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  /** `null` = түлхүүр хараахан буцаж ирээгүй. */
  @Column({ name: 'returned_at', type: 'timestamptz', nullable: true })
  returnedAt: Date | null;

  @Column({ name: 'returned_by', type: 'uuid', nullable: true })
  returnedBy: string | null;

  /** Түрээсийн төлбөр (₮). Өдрийн түлхүүр үнэгүй тул 0. */
  @Column({ type: 'bigint', default: 0 })
  amount: string;

  @Column({ type: 'varchar', length: 12, nullable: true })
  source: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
