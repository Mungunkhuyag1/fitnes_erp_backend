import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, LessThan, Repository } from 'typeorm';
import { pageResult, type PageResult } from '../../common/dto/paginated';
import {
  InvoiceStatus,
  MembershipSource,
  MemberStatus,
} from '../../common/enums/member-status.enum';
import { AuditService } from '../audit/audit.service';
import { Member } from '../member/member.entity';
import { MembershipService } from '../membership/membership.service';
import { Package } from '../package/package.entity';
import { BonumService } from './bonum.service';
import type { CreateInvoiceDto, ListInvoicesDto } from './dto/invoice.dto';
import { Invoice } from './invoice.entity';

export interface InvoiceView {
  id: string;
  memberId: string;
  memberName?: string | null;
  packageName: string;
  days: number;
  amount: number;
  status: InvoiceStatus;
  payUrl: string | null;
  transactionId: string;
  paidAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class InvoiceService {
  private readonly log = new Logger(InvoiceService.name);

  constructor(
    @InjectRepository(Invoice) private readonly repo: Repository<Invoice>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(Package) private readonly packages: Repository<Package>,
    private readonly bonum: BonumService,
    private readonly memberships: MembershipService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
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

    const ttl = this.config.get<number>('bonum.invoiceTtlSec') ?? 300;
    const transactionId = `winfit-${randomBytes(9).toString('hex')}`;

    // Мөрийг ЭХЛЭЭД үүсгэнэ — Bonum руу явуулах `transactionId` тодорхой байх
    // ёстой, мөн PSP дуудлага унасан ч ул мөр үлдэнэ.
    const invoice = await this.repo.save(
      this.repo.create({
        memberId: member.id,
        packageId: pkg.id,
        packageName: pkg.name,
        days: pkg.days,
        amount: pkg.price,
        status: InvoiceStatus.PENDING,
        provider: 'bonum',
        transactionId,
        expiresAt: new Date(Date.now() + ttl * 1000),
        createdBy: staffUserId,
      }),
    );

    try {
      const res = await this.bonum.createInvoice({
        amount: Number(pkg.price),
        transactionId,
        callback: this.callbackUrl(),
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

  private callbackUrl(): string {
    return (
      this.config.get<string>('bonum.returnUrl') ||
      `${this.config.get<string>('dashboardUrl')}/pay/return`
    );
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
    await this.memberships.extend({
      memberId: invoice.memberId,
      packageId: invoice.packageId,
      amount: Number(invoice.amount),
      source: MembershipSource.BONUM,
      invoiceId: invoice.id,
      idempotencyKey: `invoice:${invoice.id}`,
    });

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

  async list(q: ListInvoicesDto): Promise<PageResult<InvoiceView>> {
    const qb = this.repo.createQueryBuilder('i');
    if (q.memberId) qb.andWhere('i.member_id = :m', { m: q.memberId });
    if (q.status) qb.andWhere('i.status = :s', { s: q.status });
    if (q.packageId) qb.andWhere('i.package_id = :p', { p: q.packageId });
    if (q.q?.trim()) {
      // Гишүүний НЭР/УТСААР хайх. Нэхэмжлэх дээр эдгээр байхгүй тул
      // дэд асуулгаар — JOIN хийвэл `getManyAndCount()` эвдэрнэ
      // (өмнө нь тулгарсан алдаа).
      const term = q.q.trim();
      const digits = term.replace(/\D/g, '');
      qb.andWhere(
        `i.member_id IN (
           SELECT id FROM members
           WHERE name ILIKE :like ${digits.length >= 2 ? 'OR phone LIKE :digits' : ''}
         )`,
        { like: `%${term}%`, digits: `%${digits}%` },
      );
    }
    if (q.from) qb.andWhere('i.created_at >= :from', { from: q.from });
    if (q.to) qb.andWhere('i.created_at <= :to', { to: q.to });
    qb.orderBy('i.created_at', q.order ? q.direction : 'DESC');

    const [rows, total] = await qb.skip(q.skip).take(q.take).getManyAndCount();
    const ids = [...new Set(rows.map((r) => r.memberId))];
    const members = ids.length
      ? await this.members.find({
          where: { id: In(ids) },
          select: { id: true, name: true },
        })
      : [];
    const map = new Map(members.map((m) => [m.id, m.name]));
    return pageResult(
      rows.map((r) => this.view(r, map.get(r.memberId) ?? null)),
      total,
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

  async statusOf(id: string): Promise<{ status: InvoiceStatus; paidAt: Date | null }> {
    const row = await this.find(id);
    return { status: row.status, paidAt: row.paidAt };
  }

  private async find(id: string): Promise<Invoice> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Нэхэмжлэх олдсонгүй');
    return row;
  }

  private view(i: Invoice, memberName?: string | null): InvoiceView {
    return {
      id: i.id,
      memberId: i.memberId,
      memberName: memberName ?? null,
      packageName: i.packageName,
      days: i.days,
      amount: Number(i.amount),
      status: i.status,
      payUrl: i.payUrl,
      transactionId: i.transactionId,
      paidAt: i.paidAt,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
    };
  }
}
