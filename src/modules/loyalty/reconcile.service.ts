import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { Member } from '../member/member.entity';
import { OutboxService } from '../outbox/outbox.service';
import { LoyaltyClient, type LoyaltyCardListRow } from './loyalty.client';
import { LOYALTY_TOPICS, loyaltyGroup } from './loyalty-sync.service';

export interface ReconcileResult {
  ran: boolean;
  reason?: string;
  /** Loopy-гийн зөвшөөрөгдсөн жагсаалтад дутуу байсныг нэмэв. */
  allowAdded: number;
  /**
   * Loopy дээр байгаа ч WinFit-д тохирох гишүүнгүй дугаар.
   * ЗӨВХӨН тоолно — автоматаар хасахгүй (§9.4-тэй ижил зарчим).
   */
  allowExtra: number;
  /** Loopy-гээс уншсан картын тоо. */
  cardsScanned: number;
  /** Webhook алдагдсаны улмаас холбогдоогүй байсныг сэргээв. */
  linked: number;
  /** Огноо зөрсөн тул дахин бичихээр дараалалд оруулав. */
  expiryFixed: number;
  /** WinFit дээр сери байгаа ч Loopy дээр тэр карт алга. */
  orphaned: number;
  /** Хугацаа хэтэрсэн / алдаа. */
  errors: string[];
}

/**
 * Шөнийн тулгалт — WinFit ба Loopy хоёрын зөрүүг олж засна.
 *
 * ЯАГААД ХЭРЭГТЭЙ ВЭ:
 *
 * 1. **Webhook алдагддаг.** Loopy-гийн `deliver()` нь fire-and-forget —
 *    амжилтгүй болвол ДАХИН ИЛГЭЭХГҮЙ. Гишүүн карт үүсгэх яг тэр хормыг
 *    WinFit унтарсан байвал `loopyCardSerial` хэзээ ч ирэхгүй. Тэр гишүүн
 *    картаа авсан мөртлөө буруу огноо хараад үлдэнэ — гараар ч засагдахгүй,
 *    учир нь серийг мэдэхгүй.
 *
 * 2. **Loopy тал дээр гараар өөрчлөлт хийж болно.** Тэнд картын хугацааг
 *    сольсныг WinFit мэдэхгүй.
 *
 * АРГА: гишүүн бүрд тусад нь хүсэлт явуулахын оронд өөрийн программын
 * картуудыг хуудаслаж татаад, утсаар нь ДОТООД санд тулгана. 300 гишүүнд
 * 300 хүсэлтийн оронд 3 хүсэлт.
 *
 * Энэ ажил ЮУ Ч УСТГАХГҮЙ — зөвхөн холбож, outbox-д мөр нэмнэ.
 */
@Injectable()
export class ReconcileService {
  private readonly log = new Logger(ReconcileService.name);
  private running = false;

  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly client: LoyaltyClient,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Өдөр бүр 04:00 (локал) — ачаалал хамгийн бага цагт.
   *
   * 09:00-ийн сануулгаас ӨМНӨ ажиллана: тулгалт нь картын огноог зассан
   * байвал сануулга зөв мэдээлэлтэй явна.
   */
  @Cron('0 4 * * *', { name: 'loopy-reconcile', timeZone: 'Asia/Ulaanbaatar' })
  async tick(): Promise<ReconcileResult> {
    return this.run();
  }

  async run(): Promise<ReconcileResult> {
    const empty: ReconcileResult = {
      ran: false,
      allowAdded: 0,
      allowExtra: 0,
      cardsScanned: 0,
      linked: 0,
      expiryFixed: 0,
      orphaned: 0,
      errors: [],
    };
    if (!this.client.isConfigured()) {
      return { ...empty, reason: 'Loopy тохируулаагүй' };
    }
    // Хоёр удаа зэрэг ажиллуулахгүй — cron болон гараар зэрэг дуудагдвал
    // нэг ижил гишүүнд давхар outbox мөр үүсгэнэ.
    if (this.running) return { ...empty, reason: 'Аль хэдийн ажиллаж байна' };
    this.running = true;
    try {
      return await this.doRun();
    } finally {
      this.running = false;
    }
  }

  private async doRun(): Promise<ReconcileResult> {
    const res: ReconcileResult = {
      ran: true,
      allowAdded: 0,
      allowExtra: 0,
      cardsScanned: 0,
      linked: 0,
      expiryFixed: 0,
      orphaned: 0,
      errors: [],
    };

    // ── 0. Зөвшөөрөгдсөн дугаарыг тулгах ──
    //
    // Гишүүн бүртгэхэд `ALLOW_PHONE` дараалалд ордог. Гэвч дараах
    // тохиолдолд Loopy руу хүрдэггүй:
    //   • Loopy тохируулагдаагүй байх үед бүртгэсэн (мөр `failed` болно)
    //   • Гишүүдийг санд шууд оруулсан (демо/шилжүүлэлт) — outbox мөр үүсээгүй
    // Ийм гишүүн картаа ХЭЗЭЭ Ч үүсгэж чадахгүй бөгөөд шалтгаан нь
    // хаана ч харагдахгүй. Тиймээс энд тулгана.
    try {
      const allowed = await this.client.listAllowedPhones();
      const inLoopy = new Set(allowed.map((a) => a.phone));

      // Цуцлагдсанаас бусад БҮХ гишүүн карт үүсгэх эрхтэй — хугацаа
      // дууссан хүн ч эрхээ сунгахын тулд картаа хардаг.
      const eligible = await this.members.find({
        where: { status: Not(In([MemberStatus.CANCELLED])) },
        select: { id: true, memberNo: true, name: true, phone: true },
      });

      const inWinfit = new Set(eligible.map((m) => m.phone));
      const confirmed: string[] = [];
      for (const m of eligible) {
        if (inLoopy.has(m.phone)) {
          confirmed.push(m.id);
          continue;
        }
        await this.outbox.enqueue({
          topic: LOYALTY_TOPICS.ALLOW_PHONE,
          payload: { memberId: m.id },
          groupKey: loyaltyGroup(m.id),
        });
        res.allowAdded++;
      }
      // Loopy дээр БОДИТООР байгаа нь баталгаа — outbox амжилттай болсон
      // эсэхээс илүү найдвартай (гараар нэмсэн ч энд илэрнэ).
      if (confirmed.length) {
        await this.members.update(
          { id: In(confirmed), loopyAllowedAt: IsNull() },
          { loopyAllowedAt: new Date() },
        );
      }
      res.allowExtra = allowed.filter((a) => !inWinfit.has(a.phone)).length;
      if (res.allowExtra) {
        this.log.warn(
          `Loopy жагсаалтад WinFit-д байхгүй ${res.allowExtra} дугаар байна — ` +
            'автоматаар хасаагүй',
        );
      }
    } catch (e) {
      res.errors.push(
        `Зөвшөөрөгдсөн дугаар уншиж чадсангүй: ${(e as Error).message}`,
      );
    }

    // ── 1. Loopy-гээс өөрийн программын БҮХ картыг татах ──
    const byPhone = new Map<string, LoyaltyCardListRow>();
    const bySerial = new Map<string, LoyaltyCardListRow>();
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { items, total } = await this.client.listProgramCards(page, 100);
        for (const c of items) {
          res.cardsScanned++;
          bySerial.set(c.serialNumber, c);
          const phone = digits(c.customerPhone);
          // Нэг утсанд олон карт байвал ХАМГИЙН СҮҮЛИЙНХ нь биш, эхнийх нь
          // үлдэнэ: жагсаалт `created_at DESC` тул эхнийх нь ХАМГИЙН ШИНЭ.
          if (phone && !byPhone.has(phone)) byPhone.set(phone, c);
        }
        if (items.length < 100 || res.cardsScanned >= total) break;
        if (page === MAX_PAGES) {
          res.errors.push(
            `${MAX_PAGES} хуудсаар тасаллаа — нийт ${total} карт. Хязгаарыг нэмнэ үү.`,
          );
        }
      }
    } catch (e) {
      res.errors.push(`Loopy-гээс карт уншиж чадсангүй: ${(e as Error).message}`);
      return res;
    }

    // ── 2. Холбогдоогүй гишүүдийг утсаар нь олж холбох ──
    // Цуцлагдсан гишүүнд карт холбох нь утгагүй.
    const unlinked = await this.members.find({
      where: {
        loopyCardSerial: IsNull(),
        status: Not(In([MemberStatus.CANCELLED])),
      },
      select: { id: true, memberNo: true, name: true, phone: true },
    });

    // Дөнгөж холбосон гишүүдийг тэмдэглэнэ: 3-р алхамд тэд дахин таарч,
    // ХОЁР ДАХЬ `EXTEND` дараалалд орох ба тайланд давхар тоологдоно.
    // (`extend` идемпотент тул хор хөнөөлгүй ч тайлан худал болно.)
    const justLinked = new Set<string>();

    for (const m of unlinked) {
      const card = byPhone.get(m.phone);
      if (!card) continue;
      await this.members.update(m.id, { loopyCardSerial: card.serialNumber });
      await this.outbox.enqueue([
        {
          topic: LOYALTY_TOPICS.EXTEND,
          payload: { memberId: m.id },
          groupKey: loyaltyGroup(m.id),
        },
        {
          topic: LOYALTY_TOPICS.FIELDS,
          payload: { memberId: m.id },
          groupKey: loyaltyGroup(m.id),
        },
      ]);
      res.linked++;
      justLinked.add(m.id);
      this.log.warn(
        `Алдагдсан холбоос сэргээв: №${m.memberNo} ${m.name} → ${card.serialNumber} ` +
          '(webhook хүрээгүй байна)',
      );
    }

    // ── 3. Холбогдсон гишүүдийн огноог тулгах ──
    const linked = await this.members.find({
      where: { loopyCardSerial: Not(IsNull()) },
      select: {
        id: true,
        memberNo: true,
        name: true,
        accessEndsAt: true,
        loopyCardSerial: true,
        walletDevices: true,
      },
    });

    let warnedNoWalletField = false;
    for (const m of linked) {
      // 2-р алхамд аль хэдийн EXTEND+FIELDS дараалалд орсон.
      if (justLinked.has(m.id)) continue;
      const card = bySerial.get(m.loopyCardSerial!);
      if (!card) {
        // Loopy дээр тэр карт алга — устгагдсан эсвэл өөр программынх.
        // ЮУ Ч ЗАСАХГҮЙ: сериг цэвэрлэвэл дараагийн ажиллагаанд өөр карттай
        // холбогдож болзошгүй. Хүн шийдэх ёстой.
        res.orphaned++;
        this.log.warn(
          `Сери Loopy дээр олдсонгүй: №${m.memberNo} ${m.name} → ${m.loopyCardSerial}`,
        );
        continue;
      }
      // Wallet-д нэмсэн эсэхийг шинэчилнэ — push хүрэх эсэхийг үүгээр мэднэ.
      //
      // Хуучин хувилбарын Loopy энэ талбарыг буцаадаггүй. Тэр үед `undefined`
      // ирэх ба TypeORM `undefined`-ыг УНШИХГҮЙ өнгөрдөг тул утга `null`
      // хэвээр үлдэж, гишүүн буруугаар «идэвхтэй» гэж харагдана. Иймд
      // талбар үнэхээр ирсэн эсэхийг ил шалгана.
      if (typeof card.walletDevices === 'number') {
        await this.members.update(m.id, {
          walletDevices: card.walletDevices,
          walletCheckedAt: new Date(),
        });
      } else if (!warnedNoWalletField) {
        warnedNoWalletField = true;
        res.errors.push(
          'Loopy `walletDevices` талбарыг буцаахгүй байна — Loopy backend-ийг ' +
            'дахин барьж асаана уу. Wallet-д нэмээгүй гишүүд илрэхгүй.',
        );
      }

      if (sameInstant(card.expiresAt, m.accessEndsAt)) continue;

      await this.outbox.enqueue({
        topic: LOYALTY_TOPICS.EXTEND,
        payload: { memberId: m.id },
        groupKey: loyaltyGroup(m.id),
      });
      res.expiryFixed++;
      this.log.log(
        `Огноо зөрлөө: №${m.memberNo} Loopy=${card.expiresAt ?? 'хугацаагүй'} ` +
          `WinFit=${m.accessEndsAt?.toISOString() ?? 'хугацаагүй'}`,
      );
    }

    this.log.log(
      `Тулгалт дууслаа: ${res.allowAdded} дугаар нэмэв, ` +
        `${res.cardsScanned} карт, ` +
        `${res.linked} холбов, ${res.expiryFixed} огноо зассан, ` +
        `${res.orphaned} сери олдсонгүй`,
    );
    return res;
  }
}

/** Хамгаалалт — Loopy маш олон карттай бол хязгааргүй давтахгүй. */
const MAX_PAGES = 50;

export function digits(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : null;
}

/**
 * Хоёр огноо ИЖИЛ мөч үү.
 *
 * Loopy нь ISO мөр, WinFit нь `Date` буцаана. Мөрөөр харьцуулбал
 * `…T15:59:59.999Z` ба `…T15:59:59.999+00:00` зэрэг ижил мөчийг ЗӨРСӨН гэж
 * үзээд төгсгөлгүй засварын гогцоо үүсгэнэ. Тиймээс мөчөөр харьцуулна.
 */
export function sameInstant(a: string | null, b: Date | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const t = new Date(a).getTime();
  return !Number.isNaN(t) && t === b.getTime();
}
