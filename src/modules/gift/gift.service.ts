import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { LoyaltyClient } from '../loyalty/loyalty.client';
import { GiftCard, GiftStatus } from './gift.entity';

/**
 * Бэлгийн карт.
 *
 * ★ УРСГАЛ
 *
 *  1. Админ карт үүсгэнэ → дугаарыг Loopy-гийн зөвшөөрөгдсөн жагсаалтад
 *  2. Хүлээн авагч enroll линкээр Wallet-даа авна
 *  3. WinFit нь УТСААР тааруулж карт холбоно (`sync`)
 *  4. Ресепшн дээр Loopy апп-аар уншуулна
 *  5. Ажилтан эрхийг ГАРААР сунгаад картыг «ашигласан» болгоно
 *
 * ⚠ Дуусах огноог ХАДГАЛАХГҮЙ — Loopy дээр программд тохируулсанаар
 * үйлчилнэ. Хоёр газар хадгалбал заавал зөрнө.
 */
@Injectable()
export class GiftService {
  private readonly log = new Logger(GiftService.name);

  constructor(
    @InjectRepository(GiftCard) private readonly repo: Repository<GiftCard>,
    private readonly loyalty: LoyaltyClient,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<{
    ready: boolean;
    enrollUrl: string | null;
    cards: Array<Omit<GiftCard, 'amount'> & { amount: number }>;
  }> {
    const ready = await this.loyalty.giftReady();
    let enrollUrl: string | null = null;
    if (ready) {
      try {
        enrollUrl = (await this.loyalty.giftEnrollLink()).enrollUrl ?? null;
      } catch (e) {
        this.log.warn(`Бэлгийн enroll линк авч чадсангүй: ${(e as Error).message}`);
      }
    }
    const rows = await this.repo.find({ order: { issuedAt: 'DESC' }, take: 200 });
    return {
      ready,
      enrollUrl,
      cards: rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    };
  }

  /**
   * Карт үүсгээд дугаарыг Loopy-д зөвшөөрнө.
   *
   * ⚠ Loopy дуудлага унавал карт ҮҮСГЭХГҮЙ: DB-д карт байгаа ч хүлээн
   * авагч enroll хийж чадахгүй байх нь хамгийн эвгүй байдал — ажилтан
   * «үүссэн» гэж бодоод хүлээнэ.
   */
  async create(
    input: {
      amount: number;
      recipientName: string;
      recipientPhone: string;
      buyerName?: string;
      note?: string;
    },
    user: AuthUser,
  ): Promise<GiftCard> {
    if (!(await this.loyalty.giftReady())) {
      throw new BadRequestException(
        'Бэлгийн картын Loopy программ сонгоогүй байна — Тохиргоо → Холболт',
      );
    }
    const phone = input.recipientPhone.replace(/\D/g, '');
    if (phone.length !== 8) {
      throw new BadRequestException('Утасны дугаар 8 оронтой байна');
    }
    const open = await this.repo.findOne({
      where: {
        recipientPhone: phone,
        status: In([GiftStatus.ISSUED, GiftStatus.ENROLLED]),
      },
    });
    if (open) {
      throw new BadRequestException(
        `${phone} дугаарт ашиглаагүй бэлгийн карт бий — эхлээд түүнийг ашиглана уу`,
      );
    }

    // Loopy ЭХЛЭЭД — унавал DB-д хагас карт үлдэхгүй.
    await this.loyalty.giftAllowPhone(
      phone,
      input.recipientName,
      `Бэлгийн карт ${input.amount.toLocaleString()}₮`,
    );

    const card = await this.repo.save(
      this.repo.create({
        amount: String(input.amount),
        recipientName: input.recipientName.trim(),
        recipientPhone: phone,
        buyerName: input.buyerName?.trim() || null,
        note: input.note?.trim() || null,
        status: GiftStatus.ISSUED,
        issuedBy: user.id,
      }),
    );

    await this.audit.record({
      staffUserId: user.id,
      action: 'gift.create',
      entity: 'gift',
      entityId: card.id,
      after: { amount: input.amount, phone, recipient: card.recipientName },
    });
    this.log.log(`Бэлгийн карт: ${input.amount}₮ → ${phone}`);
    return card;
  }

  /**
   * Loopy-гоос enroll хийсэн картуудыг татаж УТСААР тааруулна.
   *
   * Хүлээн авагч хэзээ enroll хийхийг WinFit мэдэхгүй тул ажилтан
   * товч дарж шинэчилнэ. Webhook байхгүй — Loopy тал энэ программын
   * enroll эвентийг WinFit рүү илгээдэггүй.
   */
  async sync(): Promise<{ linked: number; checked: number }> {
    if (!(await this.loyalty.giftReady())) {
      throw new BadRequestException('Бэлгийн картын программ сонгоогүй байна');
    }
    const pending = await this.repo.find({
      where: { status: GiftStatus.ISSUED },
    });
    if (!pending.length) return { linked: 0, checked: 0 };

    const byPhone = new Map(pending.map((c) => [c.recipientPhone, c]));
    let linked = 0;
    let checked = 0;

    for (let page = 1; page <= 20; page++) {
      const { items, total } = await this.loyalty.giftProgramCards(page, 100);
      checked += items.length;
      for (const row of items) {
        const phone = (row.customerPhone ?? '').replace(/\D/g, '');
        const card = byPhone.get(phone);
        if (!card || !row.serialNumber) continue;
        card.loopyCardSerial = row.serialNumber;
        card.loopyLinkedAt = new Date();
        card.status = GiftStatus.ENROLLED;
        await this.repo.save(card);
        byPhone.delete(phone);
        linked++;
      }
      if (items.length < 100 || checked >= total) break;
    }

    if (linked) this.log.log(`Бэлгийн карт холбов: ${linked}`);
    return { linked, checked };
  }

  /**
   * Ашигласан гэж тэмдэглэх — эрхийг ажилтан ГАРААР сунгасны дараа.
   *
   * ⚠ Loopy дээрх картын төлвийг ч солино: хүлээн авагчийн Wallet дээр
   * «ашигласан» гэж харагдахгүй бол дахин ирж ашиглах гэж оролдоно.
   */
  async markUsed(
    id: string,
    input: { memberId?: string; note?: string },
    user: AuthUser,
  ): Promise<GiftCard> {
    const card = await this.find(id);
    if (card.status === GiftStatus.USED) return card;
    if (card.status === GiftStatus.CANCELLED) {
      throw new BadRequestException('Цуцлагдсан карт');
    }

    card.status = GiftStatus.USED;
    card.usedAt = new Date();
    card.usedBy = user.id;
    card.usedMemberId = input.memberId ?? null;
    if (input.note) card.note = input.note.slice(0, 300);
    await this.repo.save(card);

    // Loopy тал унасан ч WinFit дээрх тэмдэглэгээ ҮЛДЭХ ёстой —
    // ажилтан дахин дарж давхар эрх олгохоос сэргийлнэ.
    if (card.loopyCardSerial) {
      try {
        await this.loyalty.setCardStatus(card.loopyCardSerial, 'revoked');
      } catch (e) {
        this.log.warn(
          `Loopy картын төлөв солигдсонгүй ${card.loopyCardSerial}: ${(e as Error).message}`,
        );
      }
    }
    try {
      await this.loyalty.giftDisallowPhone(card.recipientPhone);
    } catch {
      // Жагсаалтаас хасахгүй байх нь эвгүй ч эрсдэлгүй.
    }

    await this.audit.record({
      staffUserId: user.id,
      action: 'gift.use',
      entity: 'gift',
      entityId: card.id,
      after: {
        amount: Number(card.amount),
        memberId: input.memberId,
        note: input.note,
      },
    });
    return card;
  }

  async cancel(id: string, user: AuthUser): Promise<GiftCard> {
    const card = await this.find(id);
    if (card.status === GiftStatus.USED) {
      throw new BadRequestException('Ашигласан картыг цуцлах боломжгүй');
    }
    card.status = GiftStatus.CANCELLED;
    await this.repo.save(card);
    try {
      await this.loyalty.giftDisallowPhone(card.recipientPhone);
      if (card.loopyCardSerial) {
        await this.loyalty.setCardStatus(card.loopyCardSerial, 'revoked');
      }
    } catch (e) {
      this.log.warn(`Loopy цэвэрлэгээ дутуу: ${(e as Error).message}`);
    }
    await this.audit.record({
      staffUserId: user.id,
      action: 'gift.cancel',
      entity: 'gift',
      entityId: card.id,
      after: { amount: Number(card.amount) },
    });
    return card;
  }

  private async find(id: string): Promise<GiftCard> {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Бэлгийн карт олдсонгүй');
    return c;
  }
}
