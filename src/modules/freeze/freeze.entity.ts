import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum FreezeScope {
  /** Баяр, засвар — БҮХ идэвхтэй гишүүнд нөхөн олгоно. */
  GLOBAL = 'global',
  /** Нэг гишүүн — нэвтрэлт нь ХААГДАНА. */
  MEMBER = 'member',
}

@Entity('freezes')
export class Freeze {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 8 })
  scope: FreezeScope;

  /** `global` үед `null`. */
  @Index('ix_freezes_member')
  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  @Column({ type: 'varchar', length: 200 })
  reason: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  /** Төлөвлөсөн хоног. Бодитоор олгосон нь `freeze_applications`-д. */
  @Column({ type: 'int' })
  days: number;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Дууссан (хугацаа дуусах эсвэл ГАРААР эрт дуусгасан). */
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'ended_by', type: 'uuid', nullable: true })
  endedBy: string | null;
}

/**
 * Хэн хэдэн хоног авсны бүртгэл.
 *
 * ★ `UNIQUE (freeze_id, member_id)` нь идемпотент байдлыг DB ТҮВШИНД
 * барина. Үүнгүйгээр баярын чөлөөг санамсаргүй хоёр удаа дарахад бүх
 * гишүүн ДАВХАР хоног авна.
 */
@Entity('freeze_applications')
export class FreezeApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'freeze_id', type: 'uuid' })
  freezeId: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ name: 'days_added', type: 'int' })
  daysAdded: number;

  /** Дэвтэрт бичигдсэн мөр — буцаах шаардлагатай бол эндээс олно. */
  @Column({ name: 'membership_id', type: 'uuid', nullable: true })
  membershipId: string | null;

  @CreateDateColumn({ name: 'applied_at', type: 'timestamptz' })
  appliedAt: Date;
}
