import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Нэг хүнтэй хийсэн яриа.
 *
 * ⚠ `psid` нь Page-Scoped ID — нэг хүн ХУУДАС БҮРД өөр дугаартай.
 * Facebook-ийн жинхэнэ хэрэглэгчийн ID БИШ бөгөөд өөр хуудсанд
 * ашиглах боломжгүй.
 */
@Entity('meta_conversations')
@Index('uq_meta_conv', ['pageId', 'psid'], { unique: true })
export class MetaConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'page_id', type: 'varchar', length: 40 })
  pageId: string;

  @Column({ type: 'varchar', length: 64 })
  psid: string;

  /** Messenger дээрх нэр. Профайл татагдаагүй бол `null`. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  name: string | null;

  @Column({ name: 'picture_url', type: 'varchar', length: 500, nullable: true })
  pictureUrl: string | null;

  /**
   * WinFit-ийн гишүүн.
   *
   * ⚠ Messenger УТАСНЫ ДУГААР өгдөггүй тул автоматаар таних арга
   * байхгүй — ажилтан нэг удаа гараар холбоно. Холбогдсоны дараа
   * ярианы хажууд гишүүний эрх, ирц харагдана. Энэ нь WinFit дотор
   * хайрцаг барих ЦОРЫН ГАНЦ жинхэнэ шалтгаан.
   */
  @Index('ix_meta_conv_member')
  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  @Index('ix_meta_conv_recent')
  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  @Column({
    name: 'last_message_text',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  lastMessageText: string | null;

  /**
   * Хэрэглэгч СҮҮЛД бичсэн агшин — хариу бичих цонхыг тодорхойлно.
   *
   * ⚠ Манай хариу үүнийг ШИНЭЧЛЭХГҮЙ. 24 цагийн цонх нь хэрэглэгчийн
   * сүүлийн мессежээс тоологддог; хариулсаар байж цонхыг мөнхөд
   * нээлттэй байлгах боломжгүй.
   */
  @Column({ name: 'last_inbound_at', type: 'timestamptz', nullable: true })
  lastInboundAt: Date | null;

  /** Уншаагүй мессежийн ТОО — «3 шинэ» гэдэг нь bool-оос мэдээлэлтэй. */
  @Column({ type: 'int', default: 0 })
  unread: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
