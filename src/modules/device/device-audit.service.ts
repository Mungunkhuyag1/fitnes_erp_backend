import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { Member } from '../member/member.entity';
import { OutboxService } from '../outbox/outbox.service';
import { DEVICE_TOPICS, deviceValidity, memberGroup } from './device-sync.service';
import { DEVICE_GATEWAY, type DeviceGateway } from './device.gateway';

/** Терминал дээр байгаа ч WinFit-д тохирох гишүүнгүй мөр. */
export interface ExtraUser {
  employeeNo: number;
  name: string;
  end: string | null;
}

/** WinFit ↔ терминалын зөрүү. */
export interface DeviceAuditDiff {
  ran: boolean;
  reason?: string;
  /** Терминал дээрх нийт хэрэглэгч. */
  deviceTotal: number;
  /** Терминал дээр байх ЁСТОЙ гишүүн (цуцлагдаагүй). */
  winfitTotal: number;
  /** WinFit-д байгаа ч терминал дээр АЛГА. */
  missing: { employeeNo: number; name: string }[];
  /**
   * Хоёр талд байгаа ч ЭРХИЙН ЦОНХ зөрсөн — нэвтрэлтэд НӨЛӨӨЛНӨ.
   * Автоматаар засна.
   */
  drift: { employeeNo: number; name: string; reason: string }[];
  /**
   * Зөвхөн НЭР зөрсөн — нэвтрэлтэд нөлөөлөхгүй.
   *
   * Импортын үед бүртгэлийн дугаарыг нэрнээс салгасан тул («Бат ub93…»
   * → нэр «Бат», регистр тусдаа) энэ зөрүү 300 гаруй хүн дээр гарна.
   * Автоматаар засвал шөнө бүр бүх хэрэглэгчийг дахин бичих болно —
   * тиймээс зөвхөн МЭДЭЭЛНЭ. Засах бол `resync-all`.
   */
  nameDiff: { employeeNo: number; winfit: string; device: string }[];
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
      const rows = await this.members.find({
        where: { status: Not(MemberStatus.CANCELLED) },
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
      const missing: DeviceAuditDiff['missing'] = [];
      const drift: DeviceAuditDiff['drift'] = [];
      const nameDiff: DeviceAuditDiff['nameDiff'] = [];

      for (const m of rows) {
        const d = onDevice.get(m.memberNo);
        if (!d) {
          missing.push({ employeeNo: m.memberNo, name: m.name });
          continue;
        }
        // ⚠ WinFit ЯГ ЮУ БИЧИХ БАЙСАН бэ гэдэгтэй харьцуулна — өөрийн
        // дүрэм зохиовол хэзээ ч арилахгүй хуурамч зөрүү үүснэ.
        const want = deviceValidity(m);
        const reasons: string[] = [];
        if (day(d.end) !== day(want.end)) reasons.push('дуусах огноо');
        if (d.enable !== want.enable) reasons.push('идэвх');
        if (d.name !== m.name) {
          nameDiff.push({ employeeNo: m.memberNo, winfit: m.name, device: d.name });
        }
        if (reasons.length) {
          drift.push({
            employeeNo: m.memberNo,
            name: m.name,
            reason: reasons.join(', '),
          });
        }
      }

      const known = new Set(rows.map((m) => m.memberNo));
      const extras = deviceUsers
        .filter((u) => !known.has(u.employeeNo))
        .map((u) => ({
          employeeNo: u.employeeNo,
          name: u.name,
          end: u.end ? u.end.toISOString() : null,
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
