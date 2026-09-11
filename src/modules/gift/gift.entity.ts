import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum GiftStatus {
  /** Үүсгэсэн, дугаарыг Loopy-д зөвшөөрсөн — хүлээн авагч аваагүй. */
  ISSUED = 'issued',
  /** Хүлээн авагч Wallet-даа авсан — карт холбогдсон. */
  ENROLLED = 'enrolled',
  /** Ашигласан — эрх сунгагдсан. */
  USED = 'used',
  CANCELLED = 'cancelled',
}

export const GIFT_STATUS_LABEL: Record<GiftStatus, string> = {
  [GiftStatus.ISSUED]: 'Хүлээгдэж буй',
  [GiftStatus.ENROLLED]: 'Wallet-д авсан',
  [GiftStatus.USED]: 'Ашигласан',
  [GiftStatus.CANCELLED]: 'Цуцлагдсан',
};

@Entity('gift_cards')
export class GiftCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Мөнгөн дүн. Ресепшн энэ дүнд тохирох эрхийг гараар сунгана. */
  @Column({ type: 'bigint' })
  amount: string;

  @Column({ name: 'recipient_name', type: 'varchar', length: 120 })
  recipientName: string;

  /**
   * ⚠ Дугаар нь Loopy-гийн зөвшөөрөгдсөн жагсаалтын түлхүүр БӨГӨӨД
   * enroll хийсэн картыг тааруулах цорын ганц зам. Буруу бол карт нь
   * хэнийх болох нь мэдэгдэхгүй.
   */
  @Column({ name: 'recipient_phone', type: 'varchar', length: 20 })
  recipientPhone: string;

  @Column({ name: 'buyer_name', type: 'varchar', length: 120, nullable: true })
  buyerName: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Index('ix_gift_status')
  @Column({ type: 'varchar', length: 10, default: GiftStatus.ISSUED })
  status: GiftStatus;

  @Column({ name: 'loopy_card_serial', type: 'varchar', length: 64, nullable: true })
  loopyCardSerial: string | null;

  @Column({ name: 'loopy_linked_at', type: 'timestamptz', nullable: true })
  loopyLinkedAt: Date | null;

  @Column({ name: 'issued_by', type: 'uuid', nullable: true })
  issuedBy: string | null;

  @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ name: 'used_by', type: 'uuid', nullable: true })
  usedBy: string | null;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  /** Хэний эрхэд ашигласан бэ. */
  @Column({ name: 'used_member_id', type: 'uuid', nullable: true })
  usedMemberId: string | null;
}
