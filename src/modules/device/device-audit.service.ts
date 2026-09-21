import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { Member } from '../member/member.entity';
import { OutboxService } from '../outbox/outbox.service';
import { DEVICE_TOPICS, deviceValidity, memberGroup } from './device-sync.service';
import {
  DEVICE_GATEWAY,
  type DeviceGateway,
  type DeviceUserRow,
} from './device.gateway';

/** Нэг талбарын зөрүү — хоёр талын утгыг ЗЭРЭГ харуулна. */
export interface FieldDiff {
  field: string;
  winfit: string;
  device: string;
}

/**
 * Хоёр талд байгаа ч зөрүүтэй гишүүн.
 *
 * ⚠ Зөвхөн «зөрүүтэй» гэж хэлэхэд ажилтан юуг нь засахаа мэдэхгүй —
 * ЯГ ЯМАР талбар, ЯМАР утгууд зөрсөнийг харуулна.
 */
export interface DriftRow {
  employeeNo: string;
  name: string;
  fields: FieldDiff[];
}

/**
 * Бүх ангилал НЭГ хэлбэртэй.
 *
 * ЯАГААД: дэлгэц дээр «дэлгэрэнгүй» цонх нь ангилал бүрд ижил
 * хүснэгт (Талбар · WinFit · Терминал) харуулна. Ангилал болгон
 * өөр хэлбэртэй бол цонхыг гурав дахин бичих болно.
 *
 * Талд байхгүй утгыг `—` гэж бичнэ: «терминал дээр алга» дээр
 * терминалын багана бүхэлдээ `—`, «WinFit-д алга» дээр эсрэгээрээ.
 */
export type ExtraUser = DriftRow;

/** WinFit ↔ терминалын зөрүү. */
export interface DeviceAuditDiff {
  ran: boolean;
  reason?: string;
  /** Терминал дээрх нийт хэрэглэгч. */
  deviceTotal: number;
  /** Терминал дээр байх ЁСТОЙ гишүүн (цуцлагдаагүй). */
  winfitTotal: number;
  /** WinFit-д байгаа ч терминал дээр АЛГА. */
  missing: DriftRow[];
  /**
   * Хоёр талд байгаа ч ЭРХИЙН ЦОНХ зөрсөн — нэвтрэлтэд НӨЛӨӨЛНӨ.
   * Автоматаар засна.
   */
  drift: DriftRow[];
  /**
   * Зөвхөн НЭР зөрсөн — нэвтрэлтэд нөлөөлөхгүй.
   *
   * Импортын үед бүртгэлийн дугаарыг нэрнээс салгасан тул («Бат ub93…»
   * → нэр «Бат», регистр тусдаа) энэ зөрүү 300 гаруй хүн дээр гарна.
   * Автоматаар засвал шөнө бүр бүх хэрэглэгчийг дахин бичих болно —
   * тиймээс зөвхөн МЭДЭЭЛНЭ. Засах бол `resync-all`.
   */
  nameDiff: DriftRow[];
  /** Терминал дээр байгаа ч WinFit-д алга — АВТОМАТААР УСТГАХГҮЙ. */
  extras: ExtraUser[];
}

export interface DeviceAuditResult extends DeviceAuditDiff {
  /** Засахаар дараалалд оруулсан тоо (missing + drift). */
  queued: number;
}

/** Огноог өдрийн нарийвчлалаар харьцуулна. */
const day = (d: Date | null): string | null =>
  d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null;

/** Дэлгэцэд харуулах огноо. */
const text = (d: Date | null): string =>
  d ? d.toISOString().slice(0, 10) : '—';

/**
 * Терминал дээрх хэрэглэгчийг WinFit-тэй ТУЛГАНА.
 *
 * ★ ЯАГААД `DeviceReconcileService`-ЭЭС ӨӨР ВЭ
 *
 * Тэр нь `hik_sync_error` тэмдэгтэй — өөрөөр хэлбэл WinFit нь «би энд
 * унасан» гэдгээ МЭДЭЖ байгаа — гишүүдийг засдаг. Гэвч WinFit мэдэхгүй
 * зөрүү бас байна:
 *
 *  • Терминалыг reset хийсэн / солисон → бичилт «амжилттай» байсан ч
 *    хэрэглэгч алга болно
 *  • Хэн нэгэн терминал дээр гараар засварласан / устгасан
 *  • Хэн нэгэн терминал дээр гараар хэрэглэгч НЭМСЭН
 *
 * Эдгээрийг зөвхөн БОДИТ жагсаалтыг татаж харьцуулж л илрүүлнэ.
 *
 * ★ ХЭН НЬ ҮНЭН ГЭДГИЙГ ХЭН ШИЙДЭХ ВЭ
 *
 * Гишүүнчлэл, төлбөрийн эх сурвалж нь WinFit. Тиймээс `missing`, `drift`
 * хоёрыг WinFit-ийн утгаар ДАРЖ бичнэ.
 *
 * ⚠ `extras`-ыг АВТОМАТААР УСТГАХГҮЙ. Тэдгээр нь ажилтан, цэвэрлэгч,
 * түр зочин байж болно — систем нь тэднийг мэдэхгүй нь тэднийг байх
 * ёсгүй гэсэн үг БИШ. Хүн харж шийднэ (`/sync` дэлгэц).
 */
@Injectable()
export class DeviceAuditService {
  private readonly log = new Logger(DeviceAuditService.name);
  private running = false;

  constructor(
    @Inject(DEVICE_GATEWAY) private readonly device: DeviceGateway,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Өдөр бүр 02:30 — `DeviceReconcileService` (03:00)-аас ӨМНӨ.
   *
   * Энэ нь зөрүүг олж дараалалд оруулна, тэр нь үлдсэн алдааг нөхнө.
   * Мөн 09:00-ийн сануулга явахаас өмнө бүх зүйл цэгцэрсэн байна.
   *
   * ⚠ ӨДӨРТ НЭГ УДАА. Бүх хэрэглэгчийг хуудаслаж татах нь хүнд
   * (337 хүн ≈ 12 хүсэлт) — ойрхон давтвал терминал удаашрана.
   */
  @Cron('30 2 * * *', { name: 'device-audit', timeZone: 'Asia/Ulaanbaatar' })
  async tick(): Promise<void> {
    const r = await this.run();
    if (!r.ran) return;
    if (r.extras.length) {
      this.log.warn(
        `Терминал дээр WinFit-д байхгүй ${r.extras.length} хэрэглэгч байна — ` +
          `/sync дэлгэцээс шалгана уу`,
      );
    }
  }

  /** Зөрүүг олоод `missing`/`drift`-ийг засахаар дараалалд оруулна. */
  async run(): Promise<DeviceAuditResult> {
    const diff = await this.diff();
    if (!diff.ran) return { ...diff, queued: 0 };

    let queued = 0;
    for (const m of [...diff.missing, ...diff.drift]) {
      const row = await this.members.findOne({
        where: { memberNo: m.employeeNo },
        select: { id: true },
      });
      if (!row) continue;
      await this.outbox.enqueue({
        topic: DEVICE_TOPICS.USER_UPSERT,
        payload: { memberId: row.id },
        groupKey: memberGroup(row.id),
      });
      queued++;
    }

    if (queued) this.log.log(`Терминалын тулгалт: ${queued} гишүүн дахин бичигдэнэ`);
    return { ...diff, queued };
  }

  // ══════════════════════════════════════════════════════════════
  //  Мөр тус бүрийн үйлдэл — ажилтан ЧИГЛЭЛИЙГ өөрөө сонгоно
  // ══════════════════════════════════════════════════════════════

  /**
   * WinFit → терминал: нэг гишүүнийг терминал дээр дарж бичнэ.
   *
   * «Терминал дээр алга», «зөрүүтэй», «нэр зөрсөн» гурвуулан дээр
   * ажиллана — бүгд нь «WinFit-ийнхээр болго» гэсэн нэг үйлдэл.
   */
  async push(employeeNo: string): Promise<{ queued: number }> {
    const m = await this.members.findOne({
      where: { memberNo: employeeNo },
      select: { id: true },
    });
    if (!m) {
      throw new NotFoundException(`№${employeeNo} WinFit-д бүртгэлгүй байна`);
    }
    await this.outbox.enqueue({
      topic: DEVICE_TOPICS.USER_UPSERT,
      payload: { memberId: m.id },
      groupKey: memberGroup(m.id),
    });
    return { queued: 1 };
  }

  /**
   * Терминал → WinFit: терминал дээрх утгыг WinFit рүү авна.
   *
   * ⚠ ХЭВИЙН УРСГАЛЫН ЭСРЭГ. Гишүүнчлэл, төлбөрийн эх сурвалж нь WinFit
   * бөгөөд эрхийн огноог терминалаас авах нь төлбөрийн бүртгэлтэй
   * зөрчилдөж болно. Тиймээс энэ нь АВТОМАТ БИШ — ажилтан мөр тус бүр
   * дээр зориудаар сонгоно.
   *
   * Хоёр тохиолдол:
   *  • Гишүүн байхгүй → терминалын мэдээллээр ШИНЭ гишүүн үүсгэнэ
   *  • Гишүүн байгаа  → нэр, дуусах огноо, төлвийг терминалынхаар солино
   */
  async pull(employeeNo: string): Promise<{
    action: 'created' | 'updated';
    memberId: string;
    name: string;
  }> {
    const users = await this.device.listUsers();
    const u = users.find((x) => x.employeeNo === employeeNo);
    if (!u) {
      throw new NotFoundException(`№${employeeNo} терминал дээр байхгүй байна`);
    }
    return this.applyDeviceUser(u);
  }

  /**
   * Терминал дээр байгаа ч WinFit-д БАЙХГҮЙ бүх хүнийг авчрах.
   *
   * ★ ЯАГААД ТУСДАА ВЭ
   *
   * `pull()` нь дуудлага БҮРТ `listUsers()`-ыг дахин татдаг. 338 хүнийг
   * нэг нэгээр авбал терминалаас 338 удаа бүтэн жагсаалт татна — заал
   * дээрх терминал удаан, туннелээр дамжиж байгаа тул хэдэн арван
   * минут болно. Энэ нь НЭГ л удаа татаад бүгдийг боловсруулна.
   *
   * ⚠ Байгаа гишүүнийг ХӨНДӨХГҮЙ. Терминал дээрх дуусах огноо нь
   * төлбөрийн бүртгэлээс гардаггүй тул байгаа гишүүнийг дарж бичвэл
   * WinFit-ийн мөнгөний түүх ба эрхийн огноо зөрөх болно. Шинээр
   * үүсгэх нь л аюулгүй.
   */
  async pullAll(): Promise<{
    deviceTotal: number;
    created: number;
    skipped: number;
    relinked: number;
    names: string[];
    /** Импортлогдоогүй мөрүүд — ажилтан терминал дээр нь засна. */
    failed: string[];
  }> {
    const users = await this.device.listUsers();
    const existing = new Set(
      (await this.members.find({ select: { memberNo: true } })).map(
        (m) => m.memberNo,
      ),
    );

    const names: string[] = [];
    const failed: string[] = [];
    let created = 0;
    let skipped = 0;

    for (const u of users) {
      if (existing.has(u.employeeNo)) {
        skipped++;
        continue;
      }
      /*
       * ★ НЭГ МУУ МӨР БҮХ ИМПОРТЫГ УНАГААХ ЁСГҮЙ.
       *
       * Урьд нь хамгаалалтгүй байсан: терминал дээр текст дугаартай
       * ганц мөр байхад 300+ гишүүн орсны дараа `pullAll` шидэж унаж,
       * ДООРХ өнчин ирцийн холболт ХЭЗЭЭ Ч ажиллахгүй байв. Дахин
       * ажиллуулахад ч яг тэр мөр дээрээ дахин унана.
       *
       * Одоо алдааг ЦУГЛУУЛААД үргэлжилнэ — ажилтан тайлангаас нь
       * хэнийг засахаа хардаг.
       */
      try {
        const r = await this.applyDeviceUser(u);
        created++;
        if (names.length < 20) names.push(`№${u.employeeNo} ${r.name}`);
      } catch (e) {
        const who = `«${u.employeeNo}» ${u.name || '—'}`;
        failed.push(`${who}: ${(e as Error).message}`);
        this.log.error(`Терминалаас авч чадсангүй: ${who} — ${(e as Error).message}`);
      }
    }

    // ★ ӨНЧИН ИРЦИЙГ ЭЗЭНД НЬ ХОЛБОХ
    //
    // Гишүүд орж ирэхээс ӨМНӨ ирц орж ирвэл (сондгойлогч 5 мин тутам
    // ажилладаг, мөн `httpHosts` түлхэлт) `member_id` нь NULL-аар
    // бичигдэнэ. `dedupe_key` нь давхардлыг хаадаг тул тэр мөр дахин
    // БИЧИГДЭХГҮЙ — өөрөө хэзээ ч засагдахгүй, үүрд өнчин үлдэнэ.
    //
    // Тиймээс импортын дараа дугаараар нь холбоно. Зөвхөн санд —
    // терминал руу ямар ч хүсэлт явахгүй.
    const relinked: [unknown[], number] = await this.members.manager.query(
      `UPDATE access_events e SET member_id = m.id
         FROM members m
        WHERE e.member_id IS NULL
          AND e.employee_no IS NOT NULL
          AND e.employee_no = m.member_no`,
    );
    const relinkedCount = Array.isArray(relinked) ? relinked[1] : 0;

    this.log.warn(
      `Терминалаас бөөнөөр авав: ${created} шинэ, ${skipped} аль хэдийн байсан ` +
        `(терминал дээр нийт ${users.length}), ` +
        `${relinkedCount} өнчин ирц эзэндээ холбогдов` +
        (failed.length ? `, ${failed.length} мөр АЛДААТАЙ` : ''),
    );
    return {
      deviceTotal: users.length,
      created,
      skipped,
      relinked: relinkedCount,
      names,
      failed,
    };
  }

  /** Терминалын нэг мөрийг WinFit гишүүн болгох — `pull`/`pullAll` хуваалцана. */
  private async applyDeviceUser(u: DeviceUserRow): Promise<{
    action: 'created' | 'updated';
    memberId: string;
    name: string;
  }> {
    const employeeNo = u.employeeNo;

    /*
     * ★ ДУГААР ХООСОН БАЙЖ БОЛОХГҮЙ.
     *
     * Тоо байх шаардлагыг migration 1788150000000 дээр авч хаясан —
     * `Adiya` гэх мэт текст дугаар одоо хэвийн. Гэвч ХООСОН утга нь
     * өөр хэрэг: `member_no` нь гишүүнийг ирцтэй холбодог түлхүүр
     * бөгөөд хоосон байвал бүх «дугааргүй» хүн нэг мөр рүү нийлнэ.
     * Уртыг нь ч шалгана — багана `varchar(32)`.
     */
    if (!employeeNo || employeeNo.length > 32) {
      throw new BadRequestException(
        `Терминал дээрх дугаар буруу: «${employeeNo}» (нэр: ${u.name || '—'}). ` +
          'Хоосон биш, 32 тэмдэгтээс богино байх ёстой.',
      );
    }

    // ⚠ Терминалын нэр «Бат ub93052012» хэлбэртэй байж болно —
    // бүртгэлийн дугаарыг тусад нь салгана (импорттой ижил дүрэм).
    const full = (u.name ?? '').trim() || `№${employeeNo}`;
    const rx = /^(.*?)[\s]+([A-Za-zА-Яа-яӨөҮү]{2}\d{6,8}[a-z0-9]*)$/u;
    const m = rx.exec(full);
    const name = m ? m[1].trim() : full;
    const register = m ? m[2].toUpperCase() : null;

    // Төлөв нь ОГНООНООС гарна — терминалын `enable` нь хугацаа дууссан
    // ч `true` хэвээр үлддэг (импортын үед 245/339 дээр ажиглагдсан).
    const now = new Date();
    let status: MemberStatus;
    if (!u.end) status = MemberStatus.LEAD;
    else if (!u.enable) status = MemberStatus.SUSPENDED;
    else status = u.end > now ? MemberStatus.ACTIVE : MemberStatus.EXPIRED;

    const existing = await this.members.findOne({ where: { memberNo: employeeNo } });
    if (existing) {
      existing.name = name;
      if (register) existing.register = register;
      existing.accessEndsAt = u.end;
      existing.status = status;
      // Терминалынхаар болгосон тул зөрүү арилсан — синк цэвэр.
      existing.hikSyncedAt = now;
      existing.hikSyncError = null;
      await this.members.save(existing);
      this.log.warn(`Терминалаас авав: №${employeeNo} ${name} (шинэчлэв)`);
      return { action: 'updated', memberId: existing.id, name };
    }

    const created = await this.members.save(
      this.members.create({
        memberNo: employeeNo,
        name,
        register,
        // ⚠ Терминалд утас ХАДГАЛАГДДАГГҮЙ — Loopy карт үүсгэхийн тулд
        // ажилтан гараар оруулна. Дэлгэц үүнийг анхааруулна.
        phone: null,
        note: `терминалаас авав №${employeeNo}`,
        status,
        accessEndsAt: u.end,
        payToken: randomBytes(24).toString('base64url'),
        // Терминал дээр аль хэдийн байгаа тул дахин бичих шаардлагагүй.
        hikSyncedAt: now,
        createdAt: u.begin ?? now,
      }),
    );
    this.log.warn(`Терминалаас авав: №${employeeNo} ${name} (шинээр үүсгэв)`);
    return { action: 'created', memberId: created.id, name };
  }

  /*
   * ⚠ ТЕРМИНАЛААС УСТГАХ ҮЙЛДЭЛ ЭНД БАЙХГҮЙ — ЗОРИУД.
   *
   * Урьд нь `removeFromDevice()` байсан: WinFit-д бүртгэлгүй
   * хэрэглэгчийг терминалаас арилгадаг байв.
   *
   * ЯАГААД ХАСАВ: терминал бол заалны цорын ганц хуулбар — нөөцгүй.
   * WinFit-д хүн байхгүй байх нь тэр хүн БАЙХГҮЙ гэсэн үг БИШ,
   * ихэвчлэн зүгээр л импортлогдоогүй гэсэн үг. Нэг удаа ийм
   * цэвэрлэгээнд жинхэнэ хоёр гишүүн устсан.
   *
   * Тулгалт одоо ЗӨВХӨН нэг чиглэлтэй: терминал → WinFit
   * (`pull`, `pullAll`). Илүүдэл олдвол мэдээлнэ, арилгахгүй.
   */

  /**
   * ЗӨВХӨН харьцуулна — юу ч бичихгүй.
   *
   * Дэлгэц үүнийг «устгах уу» гэж асуухаас өмнө харуулна.
   */
  async diff(): Promise<DeviceAuditDiff> {
    const empty: DeviceAuditDiff = {
      ran: false,
      deviceTotal: 0,
      winfitTotal: 0,
      missing: [],
      drift: [],
      nameDiff: [],
      extras: [],
    };

    if (this.running) return { ...empty, reason: 'Аль хэдийн ажиллаж байна' };
    // Терминалтай ярьж чадахгүй горимд утгагүй.
    if (this.config.get<string>('gateways.device') === 'agent') {
      return { ...empty, reason: 'Agent горимд дэмжигдээгүй' };
    }

    this.running = true;
    try {
      const deviceUsers = await this.device.listUsers();
      /*
       * ⚠ Цуцлагдсан гишүүнийг ч ОРУУЛНА.
       *
       * Урьд нь тэднийг хассан байв — учир нь цуцлахад терминалаас
       * УСТГАДАГ байсан. Одоо устгахгүй, зөвхөн унтраадаг тул тэд
       * терминал дээр байх ЁСТОЙ. Хасвал тулгалт тэднийг «илүүдэл»
       * гэж мөнхөд заасаар байх болно.
       */
      const rows = await this.members.find({
        // `deviceValidity` нь `createdAt`-ыг ашигладаг тул заавал сонгоно.
        select: {
          id: true,
          memberNo: true,
          name: true,
          status: true,
          accessEndsAt: true,
          createdAt: true,
        },
      });

      const onDevice = new Map(deviceUsers.map((u) => [u.employeeNo, u]));
      const missing: DriftRow[] = [];
      const drift: DriftRow[] = [];
      const nameDiff: DriftRow[] = [];

      for (const m of rows) {
        const d = onDevice.get(m.memberNo);
        if (!d) {
          const want = deviceValidity(m);
          missing.push({
            employeeNo: m.memberNo,
            name: m.name,
            fields: [
              { field: 'Нэр', winfit: m.name, device: '—' },
              { field: 'Дуусах огноо', winfit: text(want.end), device: '—' },
              {
                field: 'Идэвх',
                winfit: want.enable ? 'Идэвхтэй' : 'Зогсоосон',
                device: '—',
              },
            ],
          });
          continue;
        }
        // ⚠ WinFit ЯГ ЮУ БИЧИХ БАЙСАН бэ гэдэгтэй харьцуулна — өөрийн
        // дүрэм зохиовол хэзээ ч арилахгүй хуурамч зөрүү үүснэ.
        const want = deviceValidity(m);
        const fields: FieldDiff[] = [];
        if (day(d.end) !== day(want.end)) {
          fields.push({
            field: 'Дуусах огноо',
            winfit: text(want.end),
            device: text(d.end),
          });
        }
        if (d.enable !== want.enable) {
          fields.push({
            field: 'Идэвх',
            winfit: want.enable ? 'Идэвхтэй' : 'Зогсоосон',
            device: d.enable ? 'Идэвхтэй' : 'Зогсоосон',
          });
        }
        const nameField: FieldDiff | null =
          d.name !== m.name
            ? { field: 'Нэр', winfit: m.name, device: d.name }
            : null;

        if (fields.length) {
          // Нэр нь бас зөрсөн бол ЭНД хамт харуулна — нэг гишүүнийг
          // хоёр жагсаалтад тараавал ажилтан бүтэн зургийг харахгүй.
          drift.push({
            employeeNo: m.memberNo,
            name: m.name,
            fields: nameField ? [...fields, nameField] : fields,
          });
        } else if (nameField) {
          nameDiff.push({
            employeeNo: m.memberNo,
            name: m.name,
            fields: [nameField],
          });
        }
      }

      const known = new Set(rows.map((m) => m.memberNo));
      const extras: DriftRow[] = deviceUsers
        .filter((u) => !known.has(u.employeeNo))
        .map((u) => ({
          employeeNo: u.employeeNo,
          name: u.name,
          fields: [
            { field: 'Нэр', winfit: '—', device: u.name },
            { field: 'Эхлэх огноо', winfit: '—', device: text(u.begin) },
            { field: 'Дуусах огноо', winfit: '—', device: text(u.end) },
            {
              field: 'Идэвх',
              winfit: '—',
              device: u.enable ? 'Идэвхтэй' : 'Зогсоосон',
            },
          ],
        }));

      return {
        ran: true,
        deviceTotal: deviceUsers.length,
        winfitTotal: rows.length,
        missing,
        drift,
        nameDiff,
        extras,
      };
    } finally {
      this.running = false;
    }
  }
}
