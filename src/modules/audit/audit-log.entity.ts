import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Гар ажиллагааны өөрчлөлтийн лог.
 *
 * Мөнгө/эрхэд нөлөөлдөг бүх ГАРААР хийсэн үйлдэл энд бичигдэнэ: бэлнээр
 * сунгах, буцаалт, зогсоолт, хаалга нээх. Автомат үйлдэл (төлбөрөөр сунгах,
 * хугацаа дуусгах) энд ОРОХГҮЙ — тэдгээр нь өөрсдийн бүртгэлтэй.
 *
 * Энэ хүснэгтэд UPDATE/DELETE хийхгүй — зөвхөн нэмнэ.
 */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('ix_audit_staff')
  @Column({ name: 'staff_user_id', type: 'uuid', nullable: true })
  staffUserId: string | null;

  /** Жишээ: `membership.extend`, `member.suspend`, `device.openDoor`. */
  @Index('ix_audit_action')
  @Column({ type: 'varchar', length: 60 })
  action: string;

  @Column({ type: 'varchar', length: 40 })
  entity: string;

  @Index('ix_audit_entity')
  @Column({ name: 'entity_id', type: 'varchar', length: 64, nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Index('ix_audit_created')
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
