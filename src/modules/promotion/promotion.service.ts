import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { InvoiceStatus } from '../../common/enums/member-status.enum';
import { InvoicePromotion } from '../invoice/invoice-promotion.entity';
import { Invoice } from '../invoice/invoice.entity';
import { Package } from '../package/package.entity';
import { SettingsService } from '../settings/settings.service';
import {
  Promotion,
  PromotionChannel,
  PromotionKind,
  PromotionRedemption,
} from './promotion.entity';

/** Урамшуулал үүсгэх/засах өгөгдөл — `value` нь ТОО (entity дээр bigint→string). */
export interface PromotionInput {
  name: string;
  kind: PromotionKind;
  value: number;
  packageIds?: string[];
  startsAt?: Date | null;
  endsAt?: Date | null;
  channels?: PromotionChannel[];
  exclusive?: boolean;
  sortOrder?: number;
}

/** Нэг багцад хэрэглэгдсэн нэг урамшуулал. */
export interface AppliedPromotion {
  id: string;
  name: string;
  kind: PromotionKind;
  /** Хэдэн төгрөг хөнгөлсөн, эсвэл хэдэн хоног нэмсэн. */
  valueApplied: number;
  /** Дээд хязгаарт мөргөж ДУТУУ хэрэглэгдсэн эсэх. */
  capped: boolean;
}

/** Багцад урамшуулал хэрэглэсний дүн. */
export interface PriceQuote {
  /** Урамшууллын дараах төлөх дүн. */
  price: number;
  /** Урамшууллын дараах нийт хоног. */
  days: number;
  /** Анхны үнэ — дэлгэц дээр зурж харуулахад. */
  basePrice: number;
  baseDays: number;
  /** Нийт хөнгөлсөн дүн (₮). */
  discount: number;
  /** Хэрэглэгдсэн урамшууллууд — дарааллаараа. Хоосон бол энгийн үнэ. */
  promotions: AppliedPromotion[];
  /** Дээд хязгаар нөлөөлсөн эсэх — дэлгэц дээр анхааруулахад. */
  capped: boolean;
}

@Injectable()
export class PromotionService {
  private readonly log = new Logger(PromotionService.name);

  constructor(
    @InjectRepository(Promotion) private readonly repo: Repository<Promotion>,
    @InjectRepository(PromotionRedemption)
    private readonly redemptions: Repository<PromotionRedemption>,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Одоо үйлчилж буй урамшууллууд.
   *
   * Хугацааны цонх нь `active`-аас ТУСДАА: админ идэвхжүүлсэн ч огноо
   * нь ирээгүй байж болно. Хоёулаа таарсан үед л үйлчилнэ.
   *
   * Эрэмбэ: `sortOrder` ИХ → эрт үүссэн. Дээд хязгаарт мөргөхөд аль нь
   * бүтнээрээ орохыг энэ эрэмбэ шийднэ тул ТОГТМОЛ байх ёстой.
   */
  async activeNow(channel?: PromotionChannel): Promise<Promotion[]> {
    const rows = await this.repo.find({
      where: { active: true },
      order: { sortOrder: 'DESC', createdAt: 'ASC' },
    });
    const now = new Date();
    return rows.filter((p) => {
      if (p.startsAt && p.startsAt > now) return false;
      if (p.endsAt && p.endsAt < now) return false;
      if (channel && !p.channels.includes(channel)) return false;
      return true;
    });
  }

  /**
   * Багцын эцсийн үнэ ба хоног.
   *
   * ⚠ Үнийг СЕРВЕР тооцоолно. Клиентээс ирсэн дүнд итгэвэл хэн ч
   * хөнгөлөлттэй үнээр төлбөр үүсгэж чадна.
   */
  async quote(pkg: Package, channel: PromotionChannel): Promise<PriceQuote> {
    const [promos, maxPct] = await Promise.all([
      this.activeNow(channel),
      this.maxDiscountPct(),
    ]);
    return this.apply(pkg, promos, maxPct);
  }

  /**
   * Олон багцын үнэ — нэг дуудлагаар.
   *
   * ⚠ Багц бүрд `quote()` дуудвал урамшууллын жагсаалт ба тохиргоог
   * дахин дахин уншина: 10 багц = 20 илүүц асуулга.
   *
   * `channel` нь ФУНКЦ байж болно: нэг жагсаалтад онлайнаар зарагдах ба
   * ресепшнээр зарагдах багц ХОЁУЛАА байвал суваг нь багцаас хамаарна.
   */
  async quoteMany(
    packages: Package[],
    channel: PromotionChannel | ((pkg: Package) => PromotionChannel),
  ): Promise<Map<string, PriceQuote>> {
    const pick = typeof channel === 'function' ? channel : () => channel;
    // Суваггүйгээр НЭГ УДАА уншаад шүүлтүүрийг санах ойд хийнэ.
    const [all, maxPct] = await Promise.all([
      this.activeNow(),
      this.maxDiscountPct(),
    ]);
    return new Map(
      packages.map((p) => {
        const ch = pick(p);
        const promos = all.filter((x) => x.channels.includes(ch));
        return [p.id, this.apply(p, promos, maxPct)];
      }),
    );
  }

  /**
   * ★ ДАВХАРЛАХ ДҮРЭМ
   *
   * 1. Багцад чиглүүлсэн эсэхээр шүүнэ (`packageIds` хоосон = бүх багц).
   * 2. Онцгой (`exclusive`) урамшуулал тохирвол ЗӨВХӨН ТЭР үйлчилнэ —
   *    эрэмбээрээ хамгийн эхнийх нь.
   * 3. Үгүй бол бүгд ДАВХАРЛАНА. Хөнгөлөлт бүрийг АНХНЫ үнээс тооцоод
   *    нийлбэрийг хасна (additive) — «20% + 50,000₮» гэдэг нь хүн
   *    бодохдоо 200,000 + 50,000 гэж боддогтой таарна.
   * 4. Нийт хөнгөлөлт `promo_max_discount_pct`-аас хэтрэхгүй. Алдаатай
   *    тохиргооноос болж багц бараг үнэгүй зарагдахаас сэргийлнэ.
   *
   * Цэвэр функц — DB хүрэхгүй тул тооцоог нэг дор уншиж болно.
   */
  private apply(
    pkg: Package,
    promos: Promotion[],
    maxPct: number,
  ): PriceQuote {
    const basePrice = Number(pkg.price);
    const base: PriceQuote = {
      price: basePrice,
      days: pkg.days,
      basePrice,
      baseDays: pkg.days,
      discount: 0,
      promotions: [],
      capped: false,
    };

    // Хоосон жагсаалт = бүх багцад.
    const fits = promos.filter(
      (p) => !p.packageIds.length || p.packageIds.includes(pkg.id),
    );
    if (!fits.length) return base;

    const exclusive = fits.find((p) => p.exclusive);
    const chosen = exclusive ? [exclusive] : fits;

    // Хязгаарыг 100₮-д тэгшитгэнэ — эс бөгөөс таслагдсан үнэ
    // 418,733₮ болж касст эвгүй.
    const cap = Math.floor((basePrice * maxPct) / 100 / 100) * 100;

    const applied: AppliedPromotion[] = [];
    let off = 0;
    let bonusDays = 0;
    let capped = false;

    for (const p of chosen) {
      const v = Number(p.value);

      if (p.kind === PromotionKind.BONUS_DAYS) {
        // Хоног нь үнийн хязгаарт хамаарахгүй — тусдаа нэмэгдэнэ.
        bonusDays += v;
        applied.push({
          id: p.id,
          name: p.name,
          kind: p.kind,
          valueApplied: v,
          capped: false,
        });
        continue;
      }

      const raw = this.rawDiscount(p.kind, v, basePrice);
      if (raw <= 0) continue;

      const room = Math.max(0, cap - off);
      const take = Math.min(raw, room);
      if (take < raw) capped = true;
      if (take <= 0) continue;

      off += take;
      applied.push({
        id: p.id,
        name: p.name,
        kind: p.kind,
        valueApplied: take,
        capped: take < raw,
      });
    }

    if (!applied.length) return base;
    return {
      price: Math.max(0, basePrice - off),
      days: pkg.days + bonusDays,
      basePrice,
      baseDays: pkg.days,
      discount: off,
      promotions: applied,
      capped,
    };
  }

  /** Нэг урамшууллын хөнгөлөх дүн — давхарлахаас ӨМНӨХ түүхий утга. */
  private rawDiscount(
    kind: PromotionKind,
    value: number,
    basePrice: number,
  ): number {
    switch (kind) {
      case PromotionKind.PERCENT:
        // 100₮ хүртэл тэгшитгэнэ: 187,333₮ гэх мэт үнэ касст эвгүй.
        return Math.round((basePrice * value) / 100 / 100) * 100;
      case PromotionKind.AMOUNT:
        return Math.min(value, basePrice);
      case PromotionKind.FIXED_PRICE:
        // Тогтмол үнэ нь анхныхаас ӨНДӨР байвал хэрэглэхгүй — урамшуулал
        // гэж нэрлээд үнэ өсгөх нь утгагүй.
        return value >= basePrice ? 0 : basePrice - value;
      default:
        return 0;
    }
  }

  /** Нийт хөнгөлөлтийн дээд хязгаар (%) — тохиргооноос. */
  private async maxDiscountPct(): Promise<number> {
    const pct = await this.settings.get('promo_max_discount_pct');
    return Math.min(100, Math.max(0, Number(pct)));
  }

  /**
   * Ашиглалтыг бүртгэнэ.
   *
   * ⚠ Гүйлгээний ДОТОР дуудагдана (`manager` дамжуулна): гишүүнчлэл
   * үүсээгүй атал бүртгэл үлдэх ёсгүй.
   */
  async record(
    input: {
      promotionId: string;
      memberId: string;
      membershipId?: string | null;
      invoiceId?: string | null;
      kind: PromotionKind;
      valueApplied: number;
    },
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(PromotionRedemption)
      : this.redemptions;
    await repo
      .createQueryBuilder()
      .insert()
      .into(PromotionRedemption)
      .values({
        promotionId: input.promotionId,
        memberId: input.memberId,
        membershipId: input.membershipId ?? null,
        invoiceId: input.invoiceId ?? null,
        kind: input.kind,
        valueApplied: String(input.valueApplied),
      })
      .orIgnore() // давхар бүртгэлийг DB зогсооно
      .execute();
  }

  // ══════════════════════════════════════════════════════════════
  //  Удирдлага
  // ══════════════════════════════════════════════════════════════

  /** Дууссан/унтарсан ч ID-гаар олно — бүртгэл хийхэд хэрэгтэй. */
  byId(id: string): Promise<Promotion | null> {
    return this.repo.findOne({ where: { id } });
  }

  list(): Promise<Promotion[]> {
    return this.repo.find({
      order: { active: 'DESC', sortOrder: 'DESC', createdAt: 'DESC' },
    });
  }

  /** Багц сонгуулах жагсаалт — урамшууллын дэлгэцэд. */
  pickablePackages(): Promise<Package[]> {
    return this.repo.manager.getRepository(Package).find({
      where: { active: true },
      order: { sortOrder: 'ASC', price: 'ASC' },
    });
  }

  async create(input: PromotionInput, userId: string): Promise<Promotion> {
    this.assertValue(input.kind, input.value);
    return this.repo.save(
      this.repo.create({
        name: input.name,
        kind: input.kind,
        value: String(input.value),
        packageIds: input.packageIds ?? [],
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        channels: input.channels ?? [
          PromotionChannel.ONLINE,
          PromotionChannel.RECEPTION,
        ],
        exclusive: this.resolveExclusive(input.kind, input.exclusive),
        sortOrder: input.sortOrder ?? 0,
        active: false, // идэвхжүүлэх нь ТУСДАА үйлдэл
        createdBy: userId,
      }),
    );
  }

  async update(id: string, input: Partial<PromotionInput>): Promise<Promotion> {
    const p = await this.find(id);
    const kind = input.kind ?? p.kind;
    if (input.kind !== undefined || input.value !== undefined) {
      this.assertValue(kind, input.value ?? Number(p.value));
    }
    if (input.name !== undefined) p.name = input.name;
    if (input.kind !== undefined) p.kind = input.kind;
    if (input.value !== undefined) p.value = String(input.value);
    if (input.packageIds !== undefined) p.packageIds = input.packageIds;
    if (input.startsAt !== undefined) p.startsAt = input.startsAt ?? null;
    if (input.endsAt !== undefined) p.endsAt = input.endsAt ?? null;
    if (input.channels !== undefined) p.channels = input.channels;
    if (input.exclusive !== undefined || input.kind !== undefined) {
      p.exclusive = this.resolveExclusive(
        kind,
        input.exclusive ?? p.exclusive,
      );
    }
    if (input.sortOrder !== undefined) p.sortOrder = input.sortOrder;
    return this.repo.save(p);
  }

  /**
   * Идэвхжүүлэх.
   *
   * ⚠ Бусдыг УНТРААХГҮЙ (1788130000000-аас өмнө унтраадаг байв): олон
   * урамшуулал зэрэг явж давхарлах нь одоо санаатай зан төлөв.
   */
  async activate(id: string): Promise<Promotion> {
    const p = await this.find(id);
    p.active = true;
    const saved = await this.repo.save(p);
    this.log.log(`Урамшуулал идэвхжив: ${p.name}`);
    return saved;
  }

  async deactivate(id: string): Promise<Promotion> {
    const p = await this.find(id);
    p.active = false;
    return this.repo.save(p);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const used = await this.redemptions.count({ where: { promotionId: id } });
    if (used) {
      throw new BadRequestException(
        `Энэ урамшууллыг ${used} удаа ашигласан тул устгах боломжгүй — идэвхгүй болгоно уу`,
      );
    }
    // ⚠ Төлөгдөөгүй нэхэмжлэх ч мөн энэ урамшууллыг барьж байж болно.
    // Устгавал төлөгдөх агшинд бүртгэл нь эзэнгүй ID заана.
    //
    // Цуцлагдсан/хугацаа дууссан нэхэмжлэх нь хэзээ ч төлөгдөхгүй тул
    // тооцохгүй — эс бөгөөс нэг унасан төлбөр урамшууллыг мөнхөд барина.
    const pending = await this.repo.manager
      .getRepository(InvoicePromotion)
      .createQueryBuilder('ip')
      .innerJoin(Invoice, 'i', 'i.id = ip.invoice_id')
      .where('ip.promotion_id = :id', { id })
      .andWhere('i.status IN (:...live)', {
        live: [InvoiceStatus.PENDING, InvoiceStatus.PAID],
      })
      .getCount();
    if (pending) {
      throw new BadRequestException(
        `${pending} нэхэмжлэх энэ урамшууллыг хэрэглэсэн байна — идэвхгүй болгоно уу`,
      );
    }
    await this.repo.delete(id);
    return { ok: true as const };
  }

  /** Хэдэн хүн ашигласан, хэдэн төгрөг хөнгөлсөн. */
  async stats(id: string): Promise<{
    uses: number;
    members: number;
    totalValue: number;
  }> {
    return (await this.statsMany([id])).get(id) ?? EMPTY_STATS;
  }

  /**
   * Олон урамшууллын статистик — НЭГ асуулгаар.
   *
   * ⚠ Жагсаалтад урамшуулал тус бүрд асуулга явуулбал 20 урамшуулал =
   * 20 асуулга.
   */
  async statsMany(ids: string[]): Promise<Map<string, PromotionStats>> {
    const out = new Map<string, PromotionStats>();
    if (!ids.length) return out;
    const rows = await this.redemptions
      .createQueryBuilder('r')
      .where('r.promotion_id IN (:...ids)', { ids })
      .groupBy('r.promotion_id')
      .select('r.promotion_id', 'id')
      .addSelect('count(*)', 'uses')
      .addSelect('count(DISTINCT r.member_id)', 'members')
      .addSelect('coalesce(sum(r.value_applied), 0)', 'total')
      .getRawMany<{
        id: string;
        uses: string;
        members: string;
        total: string;
      }>();
    for (const id of ids) out.set(id, { ...EMPTY_STATS });
    for (const r of rows) {
      out.set(r.id, {
        uses: Number(r.uses),
        members: Number(r.members),
        totalValue: Number(r.total),
      });
    }
    return out;
  }

  /** Урамшуулал барьж буй багцуудын нэр — дэлгэцэд харуулахад. */
  async packageNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.repo.manager
      .getRepository(Package)
      .find({ where: { id: In(ids) } });
    return new Map(rows.map((p) => [p.id, p.name]));
  }

  private async find(id: string): Promise<Promotion> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Урамшуулал олдсонгүй');
    return p;
  }

  /**
   * ⚠ `fixed_price` нь ҮРГЭЛЖ онцгой — DB дээр `CK` барина. «Үнэ нь
   * 500,000₮» гэж зарлаад дээрээс нь дахин хямдруулах нь өөрийгөө
   * няцаах бөгөөд ажилтан аль нь зөв үнэ болохыг хэлж чадахгүй болно.
   */
  private resolveExclusive(kind: PromotionKind, wanted?: boolean): boolean {
    if (kind === PromotionKind.FIXED_PRICE) return true;
    return wanted ?? false;
  }

  private assertValue(kind: PromotionKind, value: number): void {
    if (value < 0) throw new BadRequestException('Утга сөрөг байж болохгүй');
    if (kind === PromotionKind.PERCENT && (value < 1 || value > 90)) {
      throw new BadRequestException('Хувь 1–90 хооронд байна');
    }
    if (kind === PromotionKind.BONUS_DAYS && (value < 1 || value > 365)) {
      throw new BadRequestException('Нэмэх хоног 1–365 хооронд байна');
    }
  }
}

export interface PromotionStats {
  uses: number;
  members: number;
  totalValue: number;
}

const EMPTY_STATS: PromotionStats = { uses: 0, members: 0, totalValue: 0 };
