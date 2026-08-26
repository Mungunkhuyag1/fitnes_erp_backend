import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Нэвтрэлт татгалзсан шалтгаан — ресепшн «яагаад орохгүй байна вэ» гэдгийг шууд харна. */
export enum AccessReason {
  OK = 'ok',
  /** Эрхийн хугацаа дууссан. */
  EXPIRED = 'expired',
  /** Түр зогсоосон гишүүн. */
  SUSPENDED = 'suspended',
  /** Царай танигдсангүй / бүртгэлгүй хүн. */
  NO_MATCH = 'no_match',
  /** Терминал дээр байгаа ч үүлэн талд гишүүн олдсонгүй. */
  UNKNOWN_MEMBER = 'unknown_member',
  OTHER = 'other',
}

/**
 * Терминалын нэвтрэлтийн эвент = ирцийн бүртгэл.
 *
 * БҮХ уншуулалт энд хадгалагдана (түүх, оношлогоо). Тайлан дээр «өдөрт 1 ирц»
 * гэж давхардлыг хасна — docs/05-backend-api.md §10.1.
 *
 * Царайн зураг ХАДГАЛАГДАХГҮЙ — agent талд хаягдана (docs/02 §10.3).
 */
@Entity('access_events')
export class AccessEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Index('ix_access_member')
  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  /** Терминал дээрх дугаар. Гишүүн олдоогүй ч хадгална. */
  @Column({ name: 'employee_no', type: 'int', nullable: true })
  employeeNo: number | null;

  @Index('ix_access_at')
  @Column({ name: 'event_at', type: 'timestamptz' })
  eventAt: Date;

  @Column({ type: 'boolean' })
  granted: boolean;

  @Column({ type: 'varchar', length: 20, default: AccessReason.OK })
  reason: AccessReason;

  /** `face` / `card` / `fingerprint` — терминалаас ирнэ. */
  @Column({ name: 'verify_mode', type: 'varchar', length: 20, nullable: true })
  verifyMode: string | null;

  /**
   * Терминалын түүхий payload.
   *
   * Эвентийн major/minor кодын утга firmware хооронд зөрдөг тул эхний үед
   * БҮТНЭЭР хадгална — mapping-ийг бодит өгөгдөл үзсэний дараа тохируулна
   * (docs/04-agent-design.md §6.2).
   */
  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;

  /**
   * Давхардал шүүх түлхүүр.
   *
   * Эвент хоёр замаар ирдэг (push + AcsEvent татагч) тул at-least-once —
   * ижил эвент 2 удаа ирж болно.
   */
  @Index('uq_access_dedupe', { unique: true })
  @Column({ name: 'dedupe_key', type: 'varchar', length: 80 })
  dedupeKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
