import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Refresh токены бүртгэл.
 *
 * Токеныг өөрийг нь хадгалахгүй — зөвхөн SHA-256 hash. DB задарсан ч
 * хүчинтэй токен гарч ирэхгүй.
 *
 * Refresh хийх бүрд хуучныг хүчингүй болгож шинийг олгоно (rotation) — хулгайд
 * алдагдсан токен нэг л удаа ажиллана, дараа нь эзэн нь refresh хийхэд
 * `revokedAt` тавигдсан байх тул илэрнэ.
 */
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('ix_refresh_staff')
  @Column({ name: 'staff_user_id', type: 'uuid' })
  staffUserId: string;

  @Index('uq_refresh_hash', { unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /** Аль төхөөрөмжөөс нэвтэрснийг харах (сэжигтэй үйлдэл шалгахад). */
  @Column({ name: 'user_agent', type: 'varchar', length: 300, nullable: true })
  userAgent: string | null;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
