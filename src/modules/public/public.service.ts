import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { daysBetween } from '../../common/utils/date.util';
import {
  isValidPhone,
  maskName,
  maskPhone,
  normalizePhone,
} from '../../common/utils/phone.util';
import { InvoiceService } from '../invoice/invoice.service';
import { Member } from '../member/member.entity';
import { Package } from '../package/package.entity';
import { SettingsService } from '../settings/settings.service';

/**
 * Нэвтрэлтгүй `/pay` хуудасны логик.
 *
 * ★ ХОЁР ТҮВШНИЙ мэдээлэл (docs/01-integration-model.md §6.6):
 *
 *   1-р түвшин (утас оруулсан) — зөвхөн ДАЛДАЛСАН нэр. Огноо, ирц, түүх
 *      ХАРАГДАХГҮЙ. Дугаар бичээд гишүүдийн мэдээлэл тандах боломжгүй.
 *   2-р түвшин (картын токентой линк) — бүрэн мэдээлэл.
 *
 * Олдоогүй ч `200 {found:false}` буцаана — статус кодоор ялгаж тандахаас
 * сэргийлнэ.
 */
@Injectable()
export class PublicService {
  private readonly log = new Logger(PublicService.name);

  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(Package) private readonly packages: Repository<Package>,
    private readonly invoices: InvoiceService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  /** Идэвхтэй багцууд — хоёр түвшинд ижил. */
  async listPackages() {
    const rows = await this.packages.find({
      where: { active: true },
      order: { sortOrder: 'ASC', price: 'ASC' },
    });
    return {
      gymName: await this.settings.get('gym_name'),
      packages: rows.map((p) => ({
        id: p.id,
        name: p.name,
        days: p.days,
        price: Number(p.price),
      })),
    };
  }

  // ── 1-р түвшин ──

  async lookup(phoneRaw: string) {
    if (!isValidPhone(phoneRaw)) {
      // Формат буруу ч 200 — «энэ дугаар бүртгэлтэй юу» гэдгийг status
      // кодоор ялгуулахгүй.
      return { found: false };
    }
    const phone = normalizePhone(phoneRaw)!;
    const member = await this.members.findOne({ where: { phone } });
    if (!member || member.status === MemberStatus.CANCELLED) {
      return { found: false };
    }
    // ⚠ ЗӨВХӨН далдалсан нэр. Хугацаа, ирц, түүх БАЙХГҮЙ.
    return { found: true, maskedName: maskName(member.name) };
  }

  // ── 2-р түвшин ──

  async byToken(token: string) {
    const member = await this.members.findOne({ where: { payToken: token } });
    if (!member || member.status === MemberStatus.CANCELLED) {
      throw new NotFoundException('Холбоос хүчингүй байна');
    }
    const pending = await this.invoices.pendingFor(member.id);
    const { gymName, packages } = await this.listPackages();
    return {
      gymName,
      name: member.name,
      // Утасгүй гишүүн (терминалаас импортлосон) — маск хийх зүйл алга.
      phone: member.phone ? maskPhone(member.phone) : null,
      status: member.status,
      accessEndsAt: member.accessEndsAt,
      daysLeft: member.accessEndsAt
        ? daysBetween(new Date(), member.accessEndsAt, this.tz)
        : null,
      packages,
      pendingInvoice: pending,
    };
  }

  // ── Нэхэмжлэх ──

  /**
   * Дүнг КЛИЕНТЭЭС авахгүй — `packageId`-гаар сервер дээрх үнээс тооцно
   * (`InvoiceService.create`). Хүлээгдэж буй нэхэмжлэх байвал шинийг
   * үүсгэхгүй, байгааг буцаана.
   */
  async createInvoice(input: {
    token?: string;
    phone?: string;
    packageId: string;
  }) {
    const member = input.token
      ? await this.members.findOne({ where: { payToken: input.token } })
      : input.phone && isValidPhone(input.phone)
        ? await this.members.findOne({
            where: { phone: normalizePhone(input.phone)! },
          })
        : null;

    if (!member || member.status === MemberStatus.CANCELLED) {
      throw new NotFoundException('Бүртгэл олдсонгүй');
    }
    if (member.status === MemberStatus.SUSPENDED) {
      throw new BadRequestException(
        'Таны эрх түр зогссон байна — ресепшнд хандана уу',
      );
    }

    const invoice = await this.invoices.create(
      { memberId: member.id, packageId: input.packageId },
      null,
    );
    this.log.log(
      `Public нэхэмжлэх: №${member.memberNo} ${invoice.packageName} ${invoice.amount}₮`,
    );
    return invoice;
  }

  /** Төлбөрийн төлөв — хуудас polling хийнэ. */
  async invoiceStatus(id: string) {
    return this.invoices.statusOf(id);
  }
}
