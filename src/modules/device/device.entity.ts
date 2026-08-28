import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Заалны терминал (Hikvision).
 *
 * Stub горимд ч нэг мөр байна — ирцийн эвент ямар хаалганаас ирснийг
 * тэмдэглэх, ирээдүйд орох/гарах хаалгыг ялгах боломжтой байхын тулд.
 */
@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index('uq_devices_serial', { unique: true })
  @Column({ type: 'varchar', length: 80 })
  serial: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  /**
   * Холболтын тохиргоо — БҮГД nullable.
   *
   * `null` = «энэ талбарыг тохируулаагүй» → `.env`-ийн утга үйлчилнэ.
   * Ингэснээр дэлгэцээс зөвхөн солигдсоныг нь дарж бичиж болно.
   */
  @Column({ type: 'int', nullable: true })
  port: number | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  username: string | null;

  /** AES-256-GCM-ээр нууцалсан. ЦЭЭЖЭЭР хадгалахгүй. */
  @Column({ name: 'password_enc', type: 'text', nullable: true })
  passwordEnc: string | null;

  @Column({ type: 'boolean', nullable: true })
  https: boolean | null;

  @Column({ name: 'door_no', type: 'int', default: 1 })
  doorNo: number;

  @Column({ type: 'varchar', length: 40, nullable: true })
  firmware: string | null;

  @Column({ type: 'boolean', default: false })
  online: boolean;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
