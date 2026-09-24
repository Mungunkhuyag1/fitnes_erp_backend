import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { pageResult, type PageResult } from '../../common/dto/paginated';
import {
  InvoiceStatus,
  MembershipSource,
  MemberStatus,
} from '../../common/enums/member-status.enum';
import { AuditService } from '../audit/audit.service';
import { maskName } from '../../common/utils/phone.util';
import { Member } from '../member/member.entity';
import { MembershipService } from '../membership/membership.service';
import { InvoiceMember } from './invoice-member.entity';
import { InvoicePromotion } from './invoice-promotion.entity';
import { Package } from '../package/package.entity';
import { PromotionChannel } from '../promotion/promotion.entity';
import { PromotionService } from '../promotion/promotion.service';
import { BonumService } from './bonum.service';
import type { CreateInvoiceDto, ListInvoicesDto } from './dto/invoice.dto';
import { Invoice } from './invoice.entity';

export interface InvoiceView {
  id: string;
  memberId: string;
  memberName?: string | null;
  /**
   * Гишүүний дугаар.
   *
   * ⚠ Урьд нь ЭНЭ ТАЛБАР БАЙГААГҮЙ атлаа dashboard нь хүлээж, `№` гэж
   * хоосон хэвлэдэг байв (`undefined !== null` нь үнэн).
   */
  memberNo?: string | null;
  packageName: string;
  days: number;
  amount: number;
  /**
   * Бодитоор ХҮЛЭЭН АВСАН дүн.
   *
   * ⚠ `amount`-аас БАГА байж болно: йогийн төлбөр хэсэгчилж ордог.
   * Орлогын нийлбэрийг ЭНЭ талбараар бодно — `amount` нь «төлөх
   * ёстой», энэ нь «орсон».
   */
  amountPaid: number;
  status: InvoiceStatus;
  /** Төлбөрийн суваг: `bonum` (онлайн) · `cash` · `manual`. */
  provider: string;
  payUrl: string | null;
  transactionId: string | null;
  paidAt: Date | null;
  /** Нэхэмжлэх хүчинтэй байх хугацаа. Гараар бүртгэсэнд утгагүй. */
  expiresAt: Date | null;
  createdAt: Date;
  /**
   * Мөр ХААНААС гарсан бэ.
   *
   * ⚠ Дэлгэц энэ хоёрыг ялгах ёстой: онлайн нэхэмжлэх 5 минутын дараа
   * өөрөө хаагддаг, гараар бүртгэсэн авлага нь хүн мөнгө авах хүртэл
   * хүлээнэ. Хоёуланг нь «хүлээгдэж буй» гэж нэг адил харуулбал
   * ажилтан авлагаа хэзээ ч цуглуулахгүй.
   */
  kind: 'invoice' | 'membership' | 'yoga';
}

/*
 * Эрэмбэлэх багана — ДТО-гийн цагаажсан жагсаалтаас ЗӨВХӨН.
 *
 * ⚠ Ажилтны өгсөн утгыг ШУУД `ORDER BY`-д ОРУУЛАХГҮЙ. Энэ
 *   зураглал ба DTO-гийн `@IsIn` хоёр хослоод SQL түлхэлтийг хаана.
 */
const INVOICE_SORT: Record<string, string> = {
  createdAt: 'created_at',
  paidAt: 'paid_at',
  amount: 'amount',
  status: 'status',
};

@Injectable()
export class InvoiceService {
  private readonly log = new Logger(InvoiceService.name);

  constructor(
    @InjectRepository(Invoice) private readonly repo: Repository<Invoice>,
    @InjectRepository(InvoiceMember)
    private readonly invoiceMembers: Repository<InvoiceMember>,
    @InjectRepository(InvoicePromotion)
    private readonly invoicePromotions: Repository<InvoicePromotion>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(Package) private readonly packages: Repository<Package>,
    private readonly bonum: BonumService,
    private readonly memberships: MembershipService,
    private readonly promotions: PromotionService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    // Төлбөрийн жагсаалт нь `invoices` + `memberships`-ыг НЭГТГЭДЭГ тул
    // нэг репозиторийн хүрээнээс гардаг (доорх `list()`-ыг үзнэ үү).
    private readonly ds: DataSource,
  ) {}

  // ══════════════════════════════════════════════════════════════
  //  Нэхэмжлэх үүсгэх
  // ══════════════════════════════════════════════════════════════

  /**
   * @param staffUserId ажилтан үүсгэвэл id, гишүүн өөрөө үүсгэвэл `null`
   */
  async create(
    dto: CreateInvoiceDto,
    staffUserId: string | null,
  ): Promise<InvoiceView> {
    const member = await this.members.findOne({ where: { id: dto.memberId } });
    if (!member) throw new NotFoundException('Гишүүн олдсонгүй');
    // Цуцлагдсан гишүүн: ажилтан төлбөр авбал эрх нь автоматаар сэргэнэ
    // (membership.extend → revive). Харин public буюу өөрөө төлөх урсгалд
    // (staffUserId === null) хориотой — цуцлалт нь хориг байж болзошгүй
    // тул ресепшнээр дамжуулна.
    if (member.status === MemberStatus.CANCELLED && !staffUserId) {
      throw new BadRequestException('Цуцлагдсан гишүүн — ресепшнд хандана уу');
    }

    const pkg = await this.packages.findOne({ where: { id: dto.packageId } });
    if (!pkg) throw new NotFoundException('Багц олдсонгүй');
    if (!pkg.active) throw new BadRequestException('Багц идэвхгүй байна');

    // ── Нэг гишүүнд нэг зэрэг НЭГ л pending нэхэмжлэх ──
    const existing = await this.repo.findOne({
      where: { memberId: member.id, status: InvoiceStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
    if (existing) {
      if (existing.expiresAt.getTime() > Date.now()) {
        this.log.log(
          `Хүлээгдэж буй нэхэмжлэх бий — шинийг үүсгэсэнгүй (${existing.transactionId})`,
        );
        return this.view(existing, member.name);
      }
      // Хугацаа дууссан бол хаагаад шинийг үүсгэнэ.
      await this.repo.update(existing.id, { status: InvoiceStatus.EXPIRED });
    }

    // ── Хосын багц: хоёр дахь гишүүнийг ЭНД шалгана ──
    let partner: Member | null = null;
    if (pkg.seats > 1) {
      if (!dto.partnerMemberId) {
        throw new BadRequestException(
          `«${pkg.name}» нь ${pkg.seats} хүний багц — хамтрагчийг сонгоно уу`,
        );
      }
      if (dto.partnerMemberId === dto.memberId) {
        throw new BadRequestException('Хоёр гишүүн ӨӨР байх ёстой');
      }
      partner = await this.members.findOne({
        where: { id: dto.partnerMemberId },
      });
      if (!partner) throw new NotFoundException('Хамтрагч олдсонгүй');
      if (partner.status === MemberStatus.CANCELLED) {
        throw new BadRequestException('Хамтрагч цуцлагдсан байна');
      }
    } else if (dto.partnerMemberId) {
      throw new BadRequestException('Энэ багц нэг хүний эрх — хамтрагч сонгох боломжгүй');
    }

    // ⚠ Үнийг СЕРВЕР тооцоолно. Клиентээс ирсэн дүнд итгэвэл хэн ч
    // хөнгөлөлттэй үнээр төлбөр үүсгэж чадна.
    const quote = await this.promotions.quote(pkg, PromotionChannel.ONLINE);

    const ttl = this.config.get<number>('bonum.invoiceTtlSec') ?? 300;
    const transactionId = `winfit-${randomBytes(9).toString('hex')}`;

    // Мөрийг ЭХЛЭЭД үүсгэнэ — Bonum руу явуулах `transactionId` тодорхой байх
    // ёстой, мөн PSP дуудлага унасан ч ул мөр үлдэнэ.
    const invoice = await this.repo.save(
      this.repo.create({
        memberId: member.id,
        packageId: pkg.id,
        packageName: pkg.name,
        // Багцын тохиргоог ХУУЛБАРЛАНА — дараа өөрчлөгдвөл аль хэдийн
        // төлөгдсөн нэхэмжлэх хөндөгдөх ёсгүй (`days`/`amount`-тай ижил).
        needsApproval: pkg.requiresProof,
        // Урамшууллын дараах утгыг ХУУЛБАРЛАНА: урамшуулал дуусахад
        // аль хэдийн үүссэн нэхэмжлэх хөндөгдөх ёсгүй. Хэрэглэсэн
        // урамшууллуудыг `invoice_promotions`-д мөр тус бүрээр хадгална.
        days: quote.days,
        amount: String(quote.price),
        status: InvoiceStatus.PENDING,
        provider: 'bonum',
        transactionId,
        expiresAt: new Date(Date.now() + ttl * 1000),
        createdBy: staffUserId,
      }),
    );

    // ⚠ Хэрэглэсэн урамшуулал бүрийг ХУУЛБАРЛАНА — хэдэн төгрөг
    // хөнгөлснийг ЭНД тогтоох нь чухал: багцын үнэ дараа өөрчлөгдвөл
    // төлөгдөх агшинд дахин тооцоолж болохгүй.
    if (quote.promotions.length) {
      await this.invoicePromotions.save(
        quote.promotions.map((q, i) =>
          this.invoicePromotions.create({
            invoiceId: invoice.id,
            promotionId: q.id,
            kind: q.kind,
            valueApplied: String(q.valueApplied),
            sortOrder: i,
          }),
        ),
      );
    }

    // Хосын багц: хамтрагчийг холбоно. Гишүүнчлэл нь ТӨЛӨГДӨХ агшинд
    // тус бүрд үүснэ — энд зөвхөн «хэн хэн» гэдгийг тэмдэглэнэ.
    if (partner) {
      await this.invoiceMembers.save([
        this.invoiceMembers.create({
          invoiceId: invoice.id,
          memberId: member.id,
          seatNo: 1,
        }),
        this.invoiceMembers.create({
          invoiceId: invoice.id,
          memberId: partner.id,
          seatNo: 2,
        }),
      ]);
    }

    try {
      const res = await this.bonum.createInvoice({
        // ⚠ БАНК РУУ урамшууллын ДАРААХ дүн явна. `pkg.price` илгээвэл
        // нэхэмжлэх дээр хөнгөлсөн ч хэрэглэгчээс БҮТЭН үнэ хасагдана.
        amount: quote.price,
        transactionId,
        callback: this.callbackUrl(invoice.id),
        description: `${pkg.name} — ${member.name}`,
      });
      invoice.providerInvoiceId = res.invoiceId;
      invoice.payUrl = res.followUpLink;
      await this.repo.save(invoice);
    } catch (e) {
      // PSP татгалзвал мөрийг цуцалж, хогийн `pending` үлдээхгүй.
      await this.repo.update(invoice.id, { status: InvoiceStatus.CANCELLED });
      throw e;
    }

    return this.view(invoice, member.name);
  }

  /**
   * Bonum-ын буцах хаяг — АЛЬ нэхэмжлэх болохыг зааж өгнө.
   *
   * Bonum нь буцаахдаа зөвхөн энэ хаягийг дуудна; нэхэмжлэхийн дугаарыг
   * өөрөө нэмдэггүй. Query-д оруулахгүй бол буцах хуудас юуг шалгахаа
   * мэдэхгүй — өмнө нь яг тэр шалтгаанаар хоосон алдаа гардаг байв.
   */
  private callbackUrl(invoiceId: string): string {
    const base =
      this.config.get<string>('bonum.returnUrl') ||
      `${this.config.get<string>('publicSiteUrl')}/pay/return`;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}invoice=${encodeURIComponent(invoiceId)}`;
  }

  // ══════════════════════════════════════════════════════════════
  //  Төлбөр батлах (webhook эсвэл гараар)
  // ══════════════════════════════════════════════════════════════

  /**
   * Нэхэмжлэхийг төлөгдсөн болгож, эрхийг сунгана.
   *
   * ИДЕМПОТЕНТ: Bonum ижил webhook-ыг хэд ч удаа илгээж болно. Аль хэдийн
   * `paid` бол юу ч хийхгүй `already` буцаана. Сунгалт нь мөн
   * `idempotencyKey = invoice:<id>`-тэй тул давхар сунгах боломжгүй.
   */
  /**
   * Баримт шалгаж эрхийг ГАРААР нээх.
   *
   * ⚠ Эрхийн хугацаа ЭНЭ агшнаас эхэлнэ, төлсөн агшнаас биш. Гишүүн
   * ресепшн хүртэл ирэх хугацаанд хоногоо алдах ёсгүй.
   *
   * ⚠ Идемпотент: `idempotencyKey` нь нэхэмжлэхээр тогтдог тул хоёр
   * ажилтан зэрэг батлахад хоёр удаа сунгахгүй.
   */
  async approve(
    invoiceId: string,
    staffUserId: string,
    note?: string,
  ): Promise<{ ok: true; already?: boolean }> {
    const invoice = await this.repo.findOne({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Нэхэмжлэх олдсонгүй');
    if (!invoice.needsApproval) {
      throw new BadRequestException('Энэ нэхэмжлэх баталгаажуулалт шаардахгүй');
    }
    if (invoice.status !== InvoiceStatus.PAID) {
      throw new BadRequestException('Төлөгдөөгүй нэхэмжлэхийг батлах боломжгүй');
    }
    if (invoice.approvedAt) return { ok: true as const, already: true };

    invoice.approvedAt = new Date();
    invoice.approvedBy = staffUserId;
    invoice.approvalNote = note?.trim() || null;
    await this.repo.save(invoice);

    const membership = await this.grant(invoice);
    await this.recordPromotion(invoice, membership.id);

    await this.audit.record({
      staffUserId,
      action: 'invoice.approve',
      entity: 'invoice',
      entityId: invoice.id,
      after: {
        packageName: invoice.packageName,
        amount: Number(invoice.amount),
        note: invoice.approvalNote,
      },
    });
    this.log.log(`Эрх батлагдав: ${invoice.packageName} — ${invoice.memberId}`);
    return { ok: true as const };
  }

  /** Төлөгдсөн ч батлагдаагүй нэхэмжлэхүүд — ажилтны дэлгэцэд. */
  async awaitingApproval(): Promise<
    Array<{
      id: string;
      memberId: string;
      memberName: string | null;
      memberNo: string | null;
      packageName: string;
      amount: number;
      paidAt: Date | null;
    }>
  > {
    const rows = await this.repo
      .createQueryBuilder('i')
      .leftJoin('members', 'm', 'm.id = i.member_id')
      .select([
        'i.id AS id',
        'i.member_id AS "memberId"',
        'i.package_name AS "packageName"',
        'i.amount AS amount',
        'i.paid_at AS "paidAt"',
        'm.name AS "memberName"',
        'm.member_no AS "memberNo"',
      ])
      .where('i.needs_approval = true')
      .andWhere('i.approved_at IS NULL')
      .andWhere('i.status = :s', { s: InvoiceStatus.PAID })
      .orderBy('i.paid_at', 'ASC')
      .getRawMany<{
        id: string;
        memberId: string;
        memberName: string | null;
        memberNo: string | null;
        packageName: string;
        amount: string;
        paidAt: Date | null;
      }>();
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  }

  async markPaid(
    ref: { transactionId?: string; providerInvoiceId?: string },
    payload: Record<string, unknown> | null,
    opts: { staffUserId?: string | null; ip?: string | null } = {},
  ): Promise<{ ok: true; already?: boolean; invoiceId?: string }> {
    const where = ref.transactionId
      ? { transactionId: ref.transactionId }
      : { providerInvoiceId: ref.providerInvoiceId! };
    const invoice = await this.repo.findOne({ where });
    if (!invoice) {
      this.log.warn(
        `Нэхэмжлэх олдсонгүй: ${ref.transactionId ?? ref.providerInvoiceId}`,
      );
      return { ok: true as const };
    }

    if (invoice.status === InvoiceStatus.PAID) {
      return { ok: true as const, already: true, invoiceId: invoice.id };
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      this.log.warn(`Цуцлагдсан нэхэмжлэх төлөгдөв: ${invoice.transactionId}`);
    }

    invoice.status = InvoiceStatus.PAID;
    invoice.paidAt = new Date();
    if (payload) invoice.rawPayload = payload;
    await this.repo.save(invoice);

    // ★ Эрх сунгах — БҮХ төлбөрийн ганц гарц (docs/05 §4.1).
    //
    // ⚠ Баримт шалгах багц дээр ЭНД СУНГАХГҮЙ. Хэрэглэгч ресепшн дээр
    // үнэмлэхээ үзүүлж, ажилтан баталсны дараа л гишүүнчлэл үүснэ
    // (`approve()`). Хугацаа нь тэр агшнаас эхэлнэ — эс бөгөөс Баасан
    // гарагт төлж Даваа гарагт ирсэн хүн 3 хоногоо алдана.
    if (invoice.needsApproval) {
      this.log.log(
        `Баталгаажуулалт хүлээнэ: ${invoice.packageName} — гишүүн ${invoice.memberId}`,
      );
    } else {
      const membership = await this.grant(invoice);
      await this.recordPromotion(invoice, membership.id);
    }

    if (opts.staffUserId) {
      // Гараар батлах нь мөнгөтэй холбоотой гар ажиллагаа — аудитад.
      await this.audit.record({
        staffUserId: opts.staffUserId,
        action: 'invoice.markPaid',
        entity: 'invoice',
        entityId: invoice.id,
        after: { amount: Number(invoice.amount), packageName: invoice.packageName },
        reason: 'Гараар батлав',
        ip: opts.ip ?? null,
      });
    }

    this.log.log(
      `Төлбөр батлагдав: ${invoice.transactionId} ${invoice.amount}₮ → эрх сунгав`,
    );
    return { ok: true as const, invoiceId: invoice.id };
  }

  /** Webhook-аас «амжилтгүй» төлөв ирэхэд. */
  async markFailed(
    ref: { transactionId?: string; providerInvoiceId?: string },
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    const where = ref.transactionId
      ? { transactionId: ref.transactionId }
      : { providerInvoiceId: ref.providerInvoiceId! };
    const invoice = await this.repo.findOne({ where });
    if (!invoice || invoice.status !== InvoiceStatus.PENDING) return;
    invoice.status = InvoiceStatus.CANCELLED;
    if (payload) invoice.rawPayload = payload;
    await this.repo.save(invoice);
  }

  async cancel(id: string): Promise<InvoiceView> {
    const invoice = await this.find(id);
    if (invoice.status !== InvoiceStatus.PENDING) {
      throw new BadRequestException('Зөвхөн хүлээгдэж буй нэхэмжлэхийг цуцална');
    }
    invoice.status = InvoiceStatus.CANCELLED;
    await this.repo.save(invoice);
    return this.view(invoice);
  }

  /** Хугацаа дууссаныг хаах — 5 минут тутам (invoice.scheduler.ts). */
  async expireStale(): Promise<number> {
    const res = await this.repo.update(
      { status: InvoiceStatus.PENDING, expiresAt: LessThan(new Date()) },
      { status: InvoiceStatus.EXPIRED },
    );
    const n = res.affected ?? 0;
    if (n) this.log.log(`Хугацаа дууссан нэхэмжлэх: ${n}`);
    return n;
  }

  // ══════════════════════════════════════════════════════════════
  //  Унших
  // ══════════════════════════════════════════════════════════════

  /**
   * Төлбөрийн бүртгэл — ОНЛАЙН ба ГАРААР хоёуланг нь.
   *
   * ★ ЯАГААД НЭГТГЭВ
   *
   * Урьд нь энэ жагсаалт зөвхөн `invoices`-ыг уншдаг байв. Гэвч
   * ресепшн дээр бэлнээр авсан төлбөр нь `memberships` мөр л үүсгэдэг,
   * нэхэмжлэх үүсгэдэггүй. Улмаар бодит мөнгөний нэлээд хэсэг Төлбөр
   * дэлгэц дээр ОГТ ХАРАГДДАГГҮЙ байсан.
   *
   * ★ ДАВХАРДАХГҮЙН УЧИР
   *
   * Онлайн төлбөр ХОЁР мөр үүсгэдэг: нэхэмжлэх ба түүнээс үүссэн
   * худалдан авалт (`invoice_id` бөглөгдсөн). Тиймээс худалдан
   * авалтаас зөвхөн `invoice_id IS NULL`-ыг авна.
   *
   * ⚠ `amount > 0` шүүлт: `freeze` (чөлөө нөхөх) ба 0 төгрөгийн
   * гараар засвар нь МӨНГӨ БИШ. Тэднийг оруулбал жагсаалт утгагүй
   * мөрөөр дүүрнэ.
   *
   * ★ ЯАГААД ТҮҮХИЙ SQL
   *
   * Хоёр хүснэгтийг `UNION` хийсний дараа хуудаслаж, эрэмбэлэх
   * шаардлагатай. TypeORM-ийн `getManyAndCount()` энэ хэлбэрийг
   * дэмждэггүй бөгөөд хоёуланг нь тусад нь татаад санах ойд нийлүүлэх
   * нь хуудаслалтыг эвдэнэ (нэг мөр хоёр хуудсанд гарах эсвэл
   * бүрмөсөн алгасагдах).
   */
  async list(q: ListInvoicesDto): Promise<PageResult<InvoiceView>> {
    const where: string[] = [];
    const p: unknown[] = [];
    const add = (v: unknown): string => `$${p.push(v)}`;

    if (q.memberId) where.push(`member_id = ${add(q.memberId)}`);
    if (q.status) where.push(`status = ${add(q.status)}`);
    if (q.packageId) where.push(`package_id = ${add(q.packageId)}`);
    if (q.from) where.push(`created_at >= ${add(q.from)}`);
    if (q.to) where.push(`created_at <= ${add(q.to)}`);
    if (q.q?.trim()) {
      /*
       * Гишүүний НЭР/УТСААР хайх. Төлбөрийн мөрөнд эдгээр байхгүй тул
       * дэд асуулгаар — JOIN нь UNION-ы дараа эрэмбийг будлиантуулна.
       */
      const term = q.q.trim();
      const digits = term.replace(/\D/g, '');
      const like = add(`%${term}%`);
      const phone = digits.length >= 2 ? add(`%${digits}%`) : null;
      where.push(
        `member_id IN (SELECT id FROM members WHERE name ILIKE ${like}` +
          (phone ? ` OR phone LIKE ${phone}` : '') +
          `)`,
      );
    }

    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = INVOICE_SORT[q.sort ?? ''] ?? 'created_at';
    const dir = q.sort || q.order ? q.direction : 'DESC';

    /*
     * ⚠ `status` нь ХОЁР эх сурвалжид ӨӨР утгатай:
     *   • нэхэмжлэх — өөрийн төлөв (pending/paid/expired/cancelled)
     *   • худалдан авалт — буцаасан бол `cancelled`, мөнгө аваагүй бол
     *     `pending` (АВЛАГА), бусад үед `paid`
     */
    const UNION = `
      SELECT i.id, i.member_id, i.package_id, i.package_name, i.days,
             i.amount::bigint AS amount,
             -- Нэхэмжлэх нь бүтнээр төлөгддөг: төлөгдсөн бол бүтэн дүн.
             (CASE WHEN i.status = 'paid' THEN i.amount ELSE 0 END)::bigint
               AS amount_paid,
             i.status::text AS status,
             i.provider, i.transaction_id, i.pay_url,
             i.paid_at, i.expires_at, i.created_at,
             'invoice'::text AS kind
        FROM invoices i
      UNION ALL
      SELECT m.id, m.member_id, m.package_id, m.package_name, m.days,
             m.amount::bigint,
             (CASE WHEN m.paid_at IS NOT NULL THEN m.amount ELSE 0 END)::bigint,
             CASE WHEN m.reversed_at IS NOT NULL THEN 'cancelled'
                  WHEN m.paid_at IS NULL          THEN 'pending'
                  ELSE 'paid' END,
             m.source, NULL, NULL,
             m.paid_at, NULL, m.created_at,
             'membership'
        FROM memberships m
       WHERE m.invoice_id IS NULL
         AND m.source IN ('cash', 'manual')
         AND m.amount::bigint > 0
      UNION ALL
      /*
       * ★ ЙОГ — ангийн бүртгэл бүр нэг мөр.
       *
       * ⚠ Заалны гишүүнчлэлээс ялгаатай нь төлбөр нь ХЭСЭГЧИЛЖ ордог.
       * Тиймээс «төлөх ёстой» (amount) ба «орсон» (amount_paid) хоёрыг
       * ТУСАД нь өгнө: 100,000/250,000 гэсэн мөрийг «төлсөн» ч
       * «төлөөгүй» ч гэж хэлэх нь худал.
       */
      SELECT e.id, e.member_id, c.id, c.name, 0,
             e.amount_due::bigint, e.amount_paid::bigint,
             CASE WHEN e.amount_paid >= e.amount_due THEN 'paid'
                  ELSE 'pending' END,
             'yoga', NULL, NULL,
             (SELECT max(p.paid_at) FROM yoga_payments p
               WHERE p.enrollment_id = e.id),
             NULL, e.created_at,
             'yoga'
        FROM yoga_enrollments e
        JOIN yoga_courses c ON c.id = e.course_id
       WHERE c.archived_at IS NULL
         AND e.amount_due::bigint > 0`;

    const [{ n }] = await this.ds.query<{ n: string }[]>(
      `SELECT count(*) AS n FROM (${UNION}) t ${filter}`,
      p,
    );

    const rows = await this.ds.query<
      {
        id: string;
        member_id: string;
        package_id: string | null;
        package_name: string | null;
        days: number;
        amount: string;
        amount_paid: string;
        status: string;
        provider: string;
        transaction_id: string | null;
        pay_url: string | null;
        paid_at: Date | null;
        expires_at: Date | null;
        created_at: Date;
        kind: 'invoice' | 'membership' | 'yoga';
      }[]
    >(
      `SELECT * FROM (${UNION}) t ${filter}
        ORDER BY ${order} ${dir}, id DESC
        LIMIT ${add(q.take)} OFFSET ${add(q.skip)}`,
      p,
    );

    const ids = [...new Set(rows.map((r) => r.member_id))];
    const members = ids.length
      ? await this.members.find({
          where: { id: In(ids) },
          select: { id: true, name: true, memberNo: true },
        })
      : [];
    const map = new Map(members.map((m) => [m.id, m]));

    return pageResult(
      rows.map((r) => ({
        id: r.id,
        memberId: r.member_id,
        memberName: map.get(r.member_id)?.name ?? null,
        memberNo: map.get(r.member_id)?.memberNo ?? null,
        packageName: r.package_name ?? '—',
        days: r.days,
        amount: Number(r.amount),
        amountPaid: Number(r.amount_paid),
        status: r.status as InvoiceStatus,
        provider: r.provider,
        payUrl: r.pay_url,
        transactionId: r.transaction_id,
        paidAt: r.paid_at,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        kind: r.kind,
      })),
      Number(n),
      q,
    );
  }


  async get(id: string): Promise<InvoiceView> {
    return this.view(await this.find(id));
  }

  /** Гишүүний хүлээгдэж буй нэхэмжлэх (public `/pay` хуудсанд). */
  async pendingFor(memberId: string): Promise<InvoiceView | null> {
    const row = await this.repo.findOne({
      where: { memberId, status: InvoiceStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    return this.view(row);
  }

  /**
   * Нийтэд нээлттэй төлөвийн хүсэлт (буцах хуудас, хүлээлтийн дэлгэц).
   *
   * ⚠ Зөвхөн ГИШҮҮНИЙ ӨӨРИЙН мэдэх ёстой зүйлийг буцаана — багц, дүн,
   * төлөв. Гишүүний нэр, утас, дугаарыг ОРУУЛАХГҮЙ: нэхэмжлэхийн ID нь
   * UUID хэдий ч энэ эндпойнт нэвтрэлтгүй.
   */
  async statusOf(id: string): Promise<{
    status: InvoiceStatus;
    paidAt: Date | null;
    packageName: string;
    days: number;
    amount: number;
    expiresAt: Date;
    memberName: string | null;
    accessEndsAt: Date | null;
    /** Эрх нээхийн өмнө ресепшн дээр баримт шалгуулах ёстой эсэх. */
    needsApproval: boolean;
    approvedAt: Date | null;
  }> {
    const row = await this.find(id);
    const member = await this.members.findOne({
      where: { id: row.memberId },
      select: { id: true, name: true, accessEndsAt: true },
    });

    return {
      status: row.status,
      paidAt: row.paidAt,
      // ⚠ /pay/return хуудас эдгээрээр «эрх нээгдээгүй» гэдгийг ТОДОРХОЙ
      // хэлнэ. Хэлэхгүй бол хэрэглэгч төлчихөөд юу ч болоогүйг хараад
      // гомдоно — энэ бол урсгалын хамгийн эрсдэлтэй цэг.
      needsApproval: row.needsApproval,
      approvedAt: row.approvedAt,
      packageName: row.packageName,
      days: row.days,
      amount: Number(row.amount),
      expiresAt: row.expiresAt,
      // ⚠ ДАЛДАЛСАН нэр. Энэ эндпойнт НЭВТРЭЛТГҮЙ — нэхэмжлэхийн ID нь
      // таамаглашгүй UUID хэдий ч бүтэн нэр буцаах нь `/pay`-ийн 1-р
      // түвшний дүрэмтэй зөрчилдөнө (docs/01 §6.6).
      memberName: member ? maskName(member.name) : null,
      // Зөвхөн ТӨЛӨГДСӨН үед — төлөгдөөгүй нэхэмжлэх дээр «хэзээ хүртэл»
      // гэдэг нь одоогийн эрхийг илчлэхээс өөр утгагүй.
      accessEndsAt:
        row.status === InvoiceStatus.PAID
          ? (member?.accessEndsAt ?? null)
          : null,
    };
  }

  private async find(id: string): Promise<Invoice> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Нэхэмжлэх олдсонгүй');
    return row;
  }

  private view(
    i: Invoice,
    memberName?: string | null,
    memberNo?: string | null,
  ): InvoiceView {
    return {
      id: i.id,
      memberId: i.memberId,
      memberName: memberName ?? null,
      memberNo: memberNo ?? null,
      packageName: i.packageName,
      days: i.days,
      amount: Number(i.amount),
      amountPaid: i.status === InvoiceStatus.PAID ? Number(i.amount) : 0,
      status: i.status,
      provider: i.provider,
      payUrl: i.payUrl,
      transactionId: i.transactionId,
      paidAt: i.paidAt,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      // Энэ зам нь ҮРГЭЛЖ нэхэмжлэх — гараар бүртгэсэн мөрийг `list()`
      // шууд угсардаг (`Invoice` entity болгодоггүй).
      kind: 'invoice' as const,
    };
  }
  /**
   * Урамшууллын ашиглалтыг бүртгэнэ.
   *
   * ⚠ Дүнг ДАХИН ТООЦООЛОХГҮЙ: нэхэмжлэх үүсэх агшинд хуулбарласан
   * `invoice_promotions` мөрүүдээс шууд уншина. Өмнө нь багцын үнээс
   * хасаж тооцдог байсан — багцын үнэ завсарт өөрчлөгдвөл статистик
   * буруу тоо бүртгэдэг байв.
   *
   * ⚠ Бүртгэл унасан ч төлбөр БҮТЭХ ёстой — статистик нь мөнгө хүлээн
   * авахыг зогсоох ёсгүй.
   */
  private async recordPromotion(
    invoice: Invoice,
    membershipId: string,
  ): Promise<void> {
    try {
      const applied = await this.invoicePromotions.find({
        where: { invoiceId: invoice.id },
        order: { sortOrder: 'ASC' },
      });
      for (const row of applied) {
        await this.promotions.record({
          promotionId: row.promotionId,
          memberId: invoice.memberId,
          membershipId,
          invoiceId: invoice.id,
          kind: row.kind,
          valueApplied: Number(row.valueApplied),
        });
      }
    } catch (e) {
      this.log.warn(
        `Урамшууллын бүртгэл хийгдсэнгүй: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Нэхэмжлэхийн эрхийг олгоно — хосын багцад ХОЁР гишүүнд.
   *
   * ★ ЯАГААД ТУС БҮРД ӨӨРИЙН МӨР ВЭ
   *
   * «Нэг гишүүн = нэг гишүүнчлэл» гэсэн таамаг систем даяар үйлчилдэг:
   * сунгалт, терминалын бичилт, Loopy карт, тайлан бүгд түүнд
   * тулгуурладаг. Нэг мөрөнд хоёр хүн заавал тэр бүхнийг өөрчилнө.
   *
   * ⚠ Дүнг ХАГАСЛАНА. Бүтэн дүнг хоёуланд нь бичвэл орлого ХОЁР
   * ДАХИН харагдана. Сондгой төгрөгийг эхний хүнд өгнө.
   */
  private async grant(invoice: Invoice): Promise<{ id: string }> {
    const seats = await this.invoiceMembers.find({
      where: { invoiceId: invoice.id },
      order: { seatNo: 'ASC' },
    });
    const total = Number(invoice.amount);

    if (!seats.length) {
      return this.memberships.extend({
        memberId: invoice.memberId,
        packageId: invoice.packageId,
        // ⚠ Нэхэмжлэхийн ХУУЛБАРЛАСАН утгыг ашиглана — урамшуулал
        // дууссан ч төлсөн хүн амласан хоногоо авах ёстой.
        days: invoice.days,
        amount: total,
        source: MembershipSource.BONUM,
        invoiceId: invoice.id,
        idempotencyKey: `invoice:${invoice.id}`,
      });
    }

    const share = Math.floor(total / seats.length);
    const extra = total - share * seats.length;
    let first: { id: string } | null = null;

    for (const seat of seats) {
      const m = await this.memberships.extend({
        memberId: seat.memberId,
        packageId: invoice.packageId,
        days: invoice.days,
        amount: share + (seat.seatNo === 1 ? extra : 0),
        source: MembershipSource.BONUM,
        invoiceId: invoice.id,
        reason: `Хосын багц (${seat.seatNo}/${seats.length})`,
        // ⚠ Түлхүүрт СУУДЛЫН дугаар орно — эс бөгөөс хоёр дахь
        // сунгалт нь эхнийхтэй ижил түлхүүртэй болж алгасагдана.
        idempotencyKey: `invoice:${invoice.id}:${seat.seatNo}`,
      });
      if (seat.seatNo === 1) first = m;
    }
    this.log.log(
      `Хосын багц олгов: ${seats.length} гишүүн × ${share}₮ (${invoice.packageName})`,
    );
    return first ?? { id: '' };
  }

}
