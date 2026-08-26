import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';

/**
 * Системд нэвтрэх ажилтан.
 *
 * v1-д мэйл сервис байхгүй тул admin шинэ ажилтанд ТҮР нууц үг тавьж амаар
 * дамжуулна (`mustChangePassword = true` → эхний нэвтрэлтэд солихыг албадана).
 * Дэлгэрэнгүй: docs/05-backend-api.md §3.1.
 */
@Entity('staff_users')
export class StaffUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Үргэлж жижиг үсгээр хадгална — нэвтрэхэд том/жижиг үсэг ялгахгүй. */
  @Index('uq_staff_email', { unique: true })
  @Column({ type: 'varchar', length: 160 })
  email: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: Role.RECEPTION })
  role: Role;

  /** Түр нууц үгтэй — солих хүртэл бусад endpoint хаагдана. */
  /**
   * Профайл зураг — `data:image/...;base64,...`.
   * Клиент тал 128×128 болгож жижигрүүлж илгээнэ (§ migration тайлбар).
   */
  @Column({ type: 'text', nullable: true })
  avatar: string | null;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;

  /** Ажлаас гарсан ажилтныг устгахгүй, идэвхгүй болгоно (аудит хэвээр). */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
