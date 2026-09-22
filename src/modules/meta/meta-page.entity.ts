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
   * Webhook баталгаажуулалтын үг.
   *
   * НУУЦ БИШ: Meta-гийн хяналтын самбар дээр ил бичигдэнэ. Зөвхөн
   * «энэ хаяг минийх мөн» гэдгийг батлахад ашиглагдана — өгөгдөл
   * хамгаалдаг нь `app_secret` дээрх гарын үсэг.
   */
  @Column({ name: 'verify_token', type: 'varchar', length: 120, nullable: true })
  verifyToken: string | null;

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
