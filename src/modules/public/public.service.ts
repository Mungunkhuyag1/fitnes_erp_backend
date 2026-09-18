import {
  BadRequestException,
  ConflictException,
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
import { MemberService } from '../member/member.service';
import { AUDIENCE_LABEL } from '../../common/enums/audience.enum';
import { Package } from '../package/package.entity';
import { PromotionChannel } from '../promotion/promotion.entity';
import { PromotionService } from '../promotion/promotion.service';
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
    private readonly promotions: PromotionService,
    private readonly memberService: MemberService,
    private readonly invoices: InvoiceService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  /**
   * Идэвхтэй БҮХ багц — нүүр хуудасны үнийн самбар ба `/pay`-д.
   *
   * ★ `payable` нь «онлайнаар ТӨЛЖ болох уу» гэдгийг заана
   *
   * Хосын багц нь хоёр гишүүнийг зэрэг сонгохыг шаарддаг тул онлайн
   * урсгалд тохирохгүй — гэхдээ ЗАРАГДДАГ. Жагсаалтаас нуувал хүн
   * тухайн үйлчилгээ байгааг мэдэхгүй; харуулаад «ресепшн дээр авна»
   * гэж хэлэх нь зөв.
   *
   * ⚠ `payable` нь ЗӨВХӨН дэлгэцийн тэмдэг. Жинхэнэ хамгаалалт нь
   * `createInvoice()` доторх шалгалт — жагсаалтад итгэвэл хэн ч
   * `packageId`-г гараар илгээж хосын багц худалдаж авна.
   */
  async listPackages() {
    const rows = await this.packages.find({
      where: { active: true },
      order: { sortOrder: 'ASC', price: 'ASC' },
    });
    // ⚠ Үнийг СЕРВЕР тооцоолно. Урамшууллыг зөвхөн дэлгэц дээр зурвал
    // жинхэнэ үнэ нь өөр байж, хэрэглэгч гайхна.
    //
    // ⚠ Багц тус бүрд `quote()` дуудвал урамшууллын жагсаалт дахин дахин
    // уншигдана — `quoteMany` нь нэг удаа уншаад бүгдэд хэрэглэнэ.
    // ⚠ Суваг нь багцаас хамаарна. Ресепшнээр зарагддаг багцад ОНЛАЙН
    // урамшууллыг бодвол нүүр хуудас 935,000₮ гэж зарлаад ресепшн
    // 1,100,000₮ авна — зочин хуурагдсан гэж бодно.
    const quotes = await this.promotions.quoteMany(rows, (p) =>
      isPayable(p) ? PromotionChannel.ONLINE : PromotionChannel.RECEPTION,
    );
    const priced = rows.map((p) => {
      const q = quotes.get(p.id)!;
      const promoted = q.promotions.length > 0;
      return {
        id: p.id,
        name: p.name,
        days: q.days,
        price: q.price,
        audience: p.audience,
        audienceLabel: AUDIENCE_LABEL[p.audience] ?? p.audience,
        // Дэлгэц эдгээрийг бүлэглэх, анхааруулах, тэмдэглэхэд ашиглана.
        requiresProof: p.requiresProof,
        firstTimeOnly: p.firstTimeOnly,
        seats: p.seats,
        payable: isPayable(p),
        // Урамшуулалтай бол анхны утгыг зурж харуулна.
        basePrice: promoted ? q.basePrice : null,
        baseDays: promoted ? q.baseDays : null,
        // Давхарласан бүх урамшуулал — нэр ба ХЭДЭН ТӨГРӨГ (эсвэл хоног)
        // нөлөөлснөөр нь. Зөвхөн нэр харуулбал «20% + 50,000₮» гэж
        // давхарласан үед аль нь хэдийг хямдруулсныг хэлж чадахгүй.
        promotions: q.promotions.map((x) => ({
          name: x.name,
          kind: x.kind,
          valueApplied: x.valueApplied,
        })),
      };
    });
    return { gymName: await this.settings.get('gym_name'), packages: priced };
  }

  /**
   * Онлайнаар өөрөө бүртгүүлэх.
   *
   * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
   *
   * Урьд нь бүртгэлгүй хүн `/pay` дээр «Ресепшнд хандана уу» гэсэн
   * мухардалд ордог байв: шөнө дунд эрх авах гэж орсон хүн маргааш
   * хүртэл хүлээнэ. Одоо өөрөө бүртгүүлээд шууд төлнө.
   *
   * ⚠ Ресепшний бүртгэлтэй ЯГ ИЖИЛ зам: `MemberService.create()` нь
   * гишүүний дугаар олгож, терминал руу бичих ба Loopy-гийн
   * зөвшөөрөгдсөн жагсаалтад нэмэх даалгаврыг нэг гүйлгээнд дараална.
   * Энд дахин бичвэл хоёр зам салж, аль нэг нь ардаа үлдэнэ.
   *
   * ⚠ Эрхийн цонх ХООСОН (`accessEndsAt` байхгүй): хэрэглэгч терминал
   * дээр үүсэх тул царайгаа бүртгүүлж чадна ч ХААЛГА НЭЭГДЭХГҮЙ.
   * Төлбөр хийгдэж гишүүнчлэл үүсэх хүртэл тэр хэвээр.
   */
  async register(input: { name: string; phone: string }) {
    if (!isValidPhone(input.phone)) {
      throw new BadRequestException('Утасны дугаар 8 оронтой байх ёстой');
    }
    const phone = normalizePhone(input.phone)!;

    // Бүртгэлтэй бол ШИНЭЭР ҮҮСГЭХГҮЙ — `lookup`-тай ижил хариу буцаана.
    // ⚠ «Энэ дугаар Болд (№1042) дээр бүртгэлтэй» гэсэн дотоод алдааг
    // гадагш гаргаж болохгүй: хэн ч дугаар оруулаад нэр, дугаарыг нь
    // мэдэх боломжтой болно.
    const existing = await this.members.findOne({ where: { phone } });
    if (existing) {
      return existing.status === MemberStatus.CANCELLED
        ? { found: false as const }
        : { found: true as const, maskedName: maskName(existing.name), created: false };
    }

    try {
      const created = await this.memberService.create({
        name: input.name,
        phone,
      });
      this.log.log(`Онлайн бүртгэл: №${created.memberNo}`);
      return {
        found: true as const,
        maskedName: maskName(created.name),
        created: true,
      };
    } catch (e) {
      // Зэрэг хоёр хүсэлт — хоёр дахь нь мөргөнө. Хэрэглэгчийн хувьд
      // бүртгэл БИЙ болсон тул амжилт гэж үзнэ.
      if (e instanceof ConflictException) {
        const row = await this.members.findOne({ where: { phone } });
        if (row) {
          return {
            found: true as const,
            maskedName: maskName(row.name),
            created: false,
          };
        }
      }
      throw e;
    }
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

    // ⚠ ЖИНХЭНЭ хамгаалалт: жагсаалтад «төлөх боломжгүй» гэж тэмдэглэх
    // нь дэлгэцийн зүйл. `packageId`-г гараар илгээхэд ямар ч саад
    // болохгүй тул багцыг ЭНД шалгана.
    const pkg = await this.packages.findOne({
      where: { id: input.packageId, active: true },
    });
    if (!pkg) throw new NotFoundException('Багц олдсонгүй');
    if (!isPayable(pkg)) {
      throw new BadRequestException(
        `«${pkg.name}» нь онлайнаар зарагддаггүй — ресепшн дээр авна`,
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

/**
 * Онлайнаар төлж болох багц уу.
 *
 * ⚠ `seats > 1` нь `online` тугаас ҮЛ ХАМААРАН хаагдана: хосын багцад
 * хоёр гишүүнийг зэрэг сонгох шаардлагатай бөгөөд public урсгалд тэр
 * дэлгэц байхгүй. Хүн 1,100,000₮ төлчихөөд нөгөө хүнээ заах газаргүй
 * үлдэх нь хамгийн муу төгсгөл.
 */
function isPayable(pkg: Package): boolean {
  return pkg.online && pkg.seats === 1;
}
