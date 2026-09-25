import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Facebook Page-ийн холболт.
 *
 * Практикт НЭГ мөр — гэвч хүснэгт болгосон нь `devices`-тэй ижил
 * шалтгаантай: нууц утгыг битүүмжилж хадгалах шаардлагатай бөгөөд
 * хожим хоёр дахь хуудас нэмэгдэж болзошгүй.
 */
@Entity('meta_pages')
export class MetaPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Facebook Page ID — Meta-гийн өгсөн тоон мөр. */
  @Index('uq_meta_page_id', { unique: true })
  @Column({ name: 'page_id', type: 'varchar', length: 40 })
  pageId: string;

  @Column({ name: 'page_name', type: 'varchar', length: 200, nullable: true })
  pageName: string | null;

  /**
   * ⚠ БИТҮҮМЖИЛСЭН (`secret-box.ts`). Түүхийгээр нь хэзээ ч
   * хадгалахгүй, логд бичихгүй, дэлгэц рүү буцаахгүй.
   */
  @Column({ name: 'token_enc', type: 'text', nullable: true })
  tokenEnc: string | null;

  @Column({ name: 'app_secret_enc', type: 'text', nullable: true })
  appSecretEnc: string | null;

  /**
   * Facebook App ID.
   *
   * ⚠ НУУЦ БИШ — клиент талын кодод ил тавигддаг нийтийн утга.
   * `app_secret`-тэй хамт «<app_id>|<app_secret>» болж АППЫН токен
   * үүсгэнэ, тэр нь `/debug_token`-д хэрэгтэй: токен хэзээ дуусахыг
   * УРЬДЧИЛАН мэдэх цорын ганц арга.
   *
   * Заавал биш — өгөөгүй бол холболт ажиллана, зөвхөн хугацааны
   * анхааруулга байхгүй болно.
   */
  @Column({ name: 'app_id', type: 'varchar', length: 40, nullable: true })
  appId: string | null;

  /**
   * Webhook баталгаажуулалтын үг.
   *
   * НУУЦ БИШ: Meta-гийн хяналтын самбар дээр ил бичигдэнэ. Зөвхөн
   * «энэ хаяг минийх мөн» гэдгийг батлахад ашиглагдана — өгөгдөл
   * хамгаалдаг нь `app_secret` дээрх гарын үсэг.
   */
  @Column({ name: 'verify_token', type: 'varchar', length: 120, nullable: true })
  verifyToken: string | null;

  /**
   * Meta ХЭЗЭЭ webhook хаягийг баталгаажуулсан (`GET hub.challenge`).
   *
   * `null` бол Meta-гийн самбарт Callback URL хараахан бүртгэгдээгүй
   * эсвэл баталгаажуулалт унасан.
   */
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  /**
   * Сүүлийн түлхэлт ХЭЗЭЭ ирсэн.
   *
   * ⚠ Гарын үсэг шалгахаас ӨМНӨ бичигдэнэ — «ирсэн ч татгалзсан»
   * гэдгийг «огт ирээгүй»-гээс ялгах цорын ганц арга.
   */
  @Column({ name: 'last_webhook_at', type: 'timestamptz', nullable: true })
  lastWebhookAt: Date | null;

  /** Сүүлийн түлхэлт татгалзсан шалтгаан. Амжилттай бол `null`. */
  @Column({ name: 'last_webhook_error', type: 'varchar', length: 300, nullable: true })
  lastWebhookError: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'connected_at', type: 'timestamptz', nullable: true })
  connectedAt: Date | null;

  @Column({ name: 'connected_by', type: 'uuid', nullable: true })
  connectedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
