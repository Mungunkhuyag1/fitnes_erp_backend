import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Gender } from '../../common/enums/gender.enum';
import { MemberStatus } from '../../common/enums/member-status.enum';

/**
 * Фитнесийн гишүүн.
 *
 * Гурван системийн холбоос (docs/01-integration-model.md §4):
 *   memberNo        → Hikvision `employeeNo`   (ДАХИН АШИГЛАХГҮЙ)
 *   phone           → Loopy customer           (гол түлхүүр)
 *   loopyCardSerial ← Loopy картын serial      (карт заавал биш — nullable)
 */
@Entity('members')
export class Member {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Хүнд харагдах дугаар = Hikvision дээрх `employeeNo`.
   * Дараалал (`member_no_seq`)-аас олгогдоно; гишүүн устсан ч дугаар нь
   * ДАХИН ОЛГОГДОХГҮЙ — эс тэгвээс хуучин ирцийн бичлэг буруу хүнд наалдана.
   */
  @Index('uq_members_no', { unique: true })
  @Column({ name: 'member_no', type: 'int' })
  memberNo: number;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /**
   * Нормчилсон 8 оронтой дугаар (common/utils/phone.util.ts).
   *
   * ⚠ NULL байж БОЛНО — терминалаас импортлосон гишүүн утасгүй ирдэг.
   * Тийм гишүүн Loopy-тэй холбогдохгүй тул dashboard дээр анхааруулга
   * харуулна. Гараар бүртгэхэд утас ЗААВАЛ хэвээр (DTO шалгана).
   */
  @Index('uq_members_phone', { unique: true })
  @Column({ type: 'varchar', length: 8 })
  phone: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  // ── Заавал биш нэмэлт мэдээлэл ──

  /** Шүүгээний өрөөг урьдчилан сонгоход, тайланд. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: Gender | null;

  /**
   * Төрсөн огноо — ЗӨВХӨН огноо (цаггүй), тиймээс `date` төрөл.
   * Насны бүлгийн тайлан, төрсөн өдрийн мэндчилгээнд.
   */
  /**
   * Регистрийн дугаар — терминалаас импортлоход нэрнээс салгасан.
   *
   * ⚠ UNIQUE БИШ: терминал дээр давхардсан, буруу бичигдсэн утга байж
   * болзошгүй бөгөөд импортыг тэр шалтгаанаар зогсоох нь буруу.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  register: string | null;

  /**
   * Царайн зургийн ЗАМ (өөрийн хадгалалт).
   *
   * ⚠ Терминалын `faceURL`-ыг хадгалахгүй — тэр нь дотоод хаяг тул
   * IP солигдох, терминал солигдоход утгагүй болно.
   */
  @Column({ name: 'photo_path', type: 'varchar', length: 300, nullable: true })
  photoPath: string | null;

  @Column({ name: 'photo_at', type: 'timestamptz', nullable: true })
  photoAt: Date | null;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: string | null;

  /**
   * Яаралтай үед холбоо барих хүн.
   *
   * Фитнест бэртэл, зүрхний хямрал зэрэг тохиолдол гардаг тул энэ нь
   * зүгээр нэг «сайхан байх» талбар биш — ажилтанд хэрэгтэй мэдээлэл.
   */
  @Column({ name: 'emergency_name', type: 'varchar', length: 120, nullable: true })
  emergencyName: string | null;

  @Column({ name: 'emergency_phone', type: 'varchar', length: 20, nullable: true })
  emergencyPhone: string | null;

  // ── Wallet картын явц (docs/08 §12) ──

  /**
   * Loopy-гийн зөвшөөрөгдсөн жагсаалтад орсныг БАТАЛСАН мөч.
   * `null` = ороогүй эсвэл хараахан батлаагүй → гишүүн карт үүсгэж чадахгүй.
   */
  @Column({ name: 'loopy_allowed_at', type: 'timestamptz', nullable: true })
  loopyAllowedAt: Date | null;

  /**
   * Картыг Apple Wallet-д нэмсэн төхөөрөмжийн тоо.
   * `0` = нэмээгүй → push мэдэгдэл хүрэхгүй. `null` = шалгаагүй.
   */
  @Column({ name: 'wallet_devices', type: 'int', nullable: true })
  walletDevices: number | null;

  @Column({ name: 'wallet_checked_at', type: 'timestamptz', nullable: true })
  walletCheckedAt: Date | null;

  @Index('ix_members_status')
  @Column({ type: 'varchar', length: 20, default: MemberStatus.LEAD })
  status: MemberStatus;

  /**
   * Эрхийн эцсийн огноо — `memberships` дэвтрээс тооцсон КЭШ.
   * Эх сурвалж нь дэвтэр; шөнийн тулгалт зөрүүг засна (docs/02 §5.4).
   */
  @Index('ix_members_ends_at')
  @Column({ name: 'access_ends_at', type: 'timestamptz', nullable: true })
  accessEndsAt: Date | null;

  // ── Төхөөрөмжийн төлөв ──

  /** Терминал дээр царай бүртгэгдсэн эсэх (зураг үүлэнд ХАДГАЛАГДАХГҮЙ). */
  @Column({ name: 'face_enrolled', type: 'boolean', default: false })
  faceEnrolled: boolean;

  @Column({ name: 'face_enrolled_at', type: 'timestamptz', nullable: true })
  faceEnrolledAt: Date | null;

  /** Терминал руу сүүлд амжилттай бичсэн үе. */
  @Column({ name: 'hik_synced_at', type: 'timestamptz', nullable: true })
  hikSyncedAt: Date | null;

  /** Сүүлийн синкийн алдаа — dashboard-ийн «Синк алдаа» дэлгэцэд. */
  @Column({ name: 'hik_sync_error', type: 'varchar', length: 500, nullable: true })
  hikSyncError: string | null;

  // ── Loopy ──

  @Index('uq_members_card', { unique: true })
  @Column({ name: 'loopy_card_serial', type: 'varchar', length: 64, nullable: true })
  loopyCardSerial: string | null;

  @Column({ name: 'loopy_customer_id', type: 'uuid', nullable: true })
  loopyCustomerId: string | null;

  // ── Төлбөр ──

  /** `/pay/:token` — гишүүн өөрөө сунгах холбоос. Сэлгэж болно. */
  @Index('uq_members_pay_token', { unique: true })
  @Column({ name: 'pay_token', type: 'varchar', length: 64 })
  payToken: string;

  /** Сүүлийн нэвтрэлт — `access_events`-ээс шинэчлэгдэх кэш (B6). */
  @Column({ name: 'last_visit_at', type: 'timestamptz', nullable: true })
  lastVisitAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
