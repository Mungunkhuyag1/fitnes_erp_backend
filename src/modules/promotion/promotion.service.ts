import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Package } from '../package/package.entity';
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
  promotion: {
    id: string;
    name: string;
    kind: PromotionKind;
    /** Хэдэн төгрөг хөнгөлсөн, эсвэл хэдэн хоног нэмсэн. */
    valueApplied: number;
  } | null;
}

@Injectable()
export class PromotionService {
  private readonly log = new Logger(PromotionService.name);

  constructor(
    @InjectRepository(Promotion) private readonly repo: Repository<Promotion>,
    @InjectRepository(PromotionRedemption)
    private readonly redemptions: Repository<PromotionRedemption>,
  ) {}

  /**
   * Одоо үйлчилж буй урамшуулал.
   *
   * Хугацааны цонх нь `active`-аас ТУСДАА: админ идэвхжүүлсэн ч огноо
   * нь ирээгүй байж болно. Хоёулаа таарсан үед л үйлчилнэ.
   */
  async current(channel?: PromotionChannel): Promise<Promotion | null> {
    const p = await this.repo.findOne({ where: { active: true } });
    if (!p) return null;
    const now = new Date();
    if (p.startsAt && p.startsAt > now) return null;
    if (p.endsAt && p.endsAt < now) return null;
    if (channel && !p.channels.includes(channel)) return null;
    return p;
  }

  /**
   * Багцын эцсийн үнэ ба хоног.
   *
   * ⚠ Үнийг СЕРВЕР тооцоолно. Клиентээс ирсэн дүнд итгэвэл хэн ч
   * хөнгөлөлттэй үнээр төлбөр үүсгэж чадна.
   */
  async quote(pkg: Package, channel: PromotionChannel): Promise<PriceQuote> {
    const basePrice = Number(pkg.price);
    const base: PriceQuote = {
      price: basePrice,
      days: pkg.days,
      basePrice,
      baseDays: pkg.days,
      promotion: null,
    };

    const p = await this.current(channel);
    if (!p) return base;
    // Хоосон жагсаалт = бүх багцад.
    if (p.packageIds.length && !p.packageIds.includes(pkg.id)) return base;

    const v = Number(p.value);
    switch (p.kind) {
      case PromotionKind.PERCENT: {
        // ⚠ Доош нь дугуйруулна — гишүүний талд. Мөн 100₮ хүртэл
        // тэгшитгэнэ: 187,333₮ гэх мэт үнэ касст эвгүй.
        const off = Math.round((basePrice * v) / 100 / 100) * 100;
        return {
          ...base,
          price: Math.max(0, basePrice - off),
          promotion: { id: p.id, name: p.name, kind: p.kind, valueApplied: off },
        };
      }
      case PromotionKind.AMOUNT: {
        const off = Math.min(v, basePrice);
        return {
          ...base,
          price: basePrice - off,
          promotion: { id: p.id, name: p.name, kind: p.kind, valueApplied: off },
        };
      }
      case PromotionKind.FIXED_PRICE: {
        // Тогтмол үнэ нь анхныхаас ӨНДӨР байвал хэрэглэхгүй — урамшуулал
        // гэж нэрлээд үнэ өсгөх нь утгагүй.
        if (v >= basePrice) return base;
        return {
          ...base,
          price: v,
          promotion: {
            id: p.id,
            name: p.name,
            kind: p.kind,
            valueApplied: basePrice - v,
          },
        };
      }
      case PromotionKind.BONUS_DAYS:
        return {
          ...base,
          days: pkg.days + v,
          promotion: { id: p.id, name: p.name, kind: p.kind, valueApplied: v },
        };
      default:
        return base;
    }
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
    return this.repo.find({ order: { createdAt: 'DESC' } });
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
    return this.repo.save(p);
  }

  /**
   * Идэвхжүүлэх — бусдыг нь унтраана.
   *
   * ⚠ Эхлээд бусдыг унтраахгүй бол DB-ийн unique индекс алдаа шидэх
   * бөгөөд ажилтан «яагаад болохгүй байна» гэж ойлгохгүй.
   */
  async activate(id: string): Promise<Promotion> {
    const p = await this.find(id);
    await this.repo.update({ active: true }, { active: false });
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
    await this.repo.delete(id);
    return { ok: true as const };
  }

  /** Хэдэн хүн ашигласан, хэдэн төгрөг хөнгөлсөн. */
  async stats(id: string): Promise<{
    uses: number;
    members: number;
    totalValue: number;
  }> {
    const row = await this.redemptions
      .createQueryBuilder('r')
      .where('r.promotion_id = :id', { id })
      .select('count(*)', 'uses')
      .addSelect('count(DISTINCT r.member_id)', 'members')
      .addSelect('coalesce(sum(r.value_applied), 0)', 'total')
      .getRawOne<{ uses: string; members: string; total: string }>();
    return {
      uses: Number(row?.uses ?? 0),
      members: Number(row?.members ?? 0),
      totalValue: Number(row?.total ?? 0),
    };
  }

  private async find(id: string): Promise<Promotion> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Урамшуулал олдсонгүй');
    return p;
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
