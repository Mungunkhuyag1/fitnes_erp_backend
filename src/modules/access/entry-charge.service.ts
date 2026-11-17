import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import {
  endOfLocalDay,
  startOfLocalDay,
} from '../../common/utils/date.util';
import {
  ENTRY_DEDUPE_FLOOR_MS,
  replayLedger,
  segmentAt,
  type EntryChargeMode,
} from '../../common/utils/ledger.util';
import { DEVICE_TOPICS, memberGroup } from '../device/device-sync.service';
import {
  LOYALTY_TOPICS,
  loyaltyGroup,
} from '../loyalty/loyalty-sync.service';
import { Member } from '../member/member.entity';
import { Membership } from '../membership/membership.entity';
import { OutboxService } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import { AccessEvent } from './access-event.entity';

/**
 * ★ ОРОЛТ ХАСАХ — оролтын багцтай гишүүн зөвшөөрөгдсөн уншуулалт хийхэд.
 *
 * ★ ЯАГААД ЭНД (ирцийн модульд) ВЭ
 *
 * `MembershipModule` нь `AccessModule`-ийг импортолдог тул эсрэгээр
 * импортловол ДАВХАР ГОГЦОО үүснэ. Дэвтрийн дүрэм нь `ledger.util.ts`-д
 * (хамааралгүй цэвэр функц) байгаа тул энд entity-ээр шууд ажиллана.
 *
 * ★ ТЕРМИНАЛ ӨӨРӨӨ ШИЙДДЭГ
 *
 * Хаалга нь зөвхөн терминал дээр бичигдсэн дуусах огноогоор хаагдана.
 * Оролт дуусахад бид `closedAt` тогтоож, дуусах огноог урагшлуулан
 * терминал руу илгээнэ (`hik.setValidity`). Тэр хүрэх хүртэлх хэдэн
 * секундэд гишүүн НЭГ удаа илүү орж болно — энэ нь зөвшөөрөгдсөн зөрүү.
 *
 * ⚠ Шийдвэр нь `access_events.entry_membership_id`-д ХАДГАЛАГДАНА —
 * тохиргоо өөрчлөгдсөн ч түүх дахин тоологдохгүй.
 */
@Injectable()
export class EntryChargeService {
  private readonly log = new Logger(EntryChargeService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  /**
   * Шинээр бичигдсэн, ЗӨВШӨӨРӨГДСӨН уншуулалт дээр дуудна.
   *
   * @returns оролт хасагдсан эсэх
   */
  async charge(eventId: string, memberId: string, eventAt: Date): Promise<boolean> {
    const mode = (await this.settings.get('entry_charge_mode')) as EntryChargeMode;
    const minutes = Number(await this.settings.get('entry_rescan_minutes')) || 0;

    return this.ds.transaction(async (m) => {
      // Гишүүний мөрийг түгжинэ — хоёр эвент (push + татагч) зэрэг ирвэл
      // хоёулаа «давхардалгүй» гэж үзээд хоёр оролт хасахаас сэргийлнэ.
      const member = await m.getRepository(Member).findOne({
        where: { id: memberId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member) return false;

      const ledger = m.getRepository(Membership);
      const rows = await ledger.find({
        where: { memberId, reversedAt: IsNull() },
        order: { createdAt: 'ASC' },
      });
      if (!rows.length) return false;

      const segs = replayLedger(rows, this.tz, rows[0].startsAt);
      const seg = segmentAt(segs, eventAt);
      // Хоногийн эрх, эсвэл ямар ч бүлэгт хамаарахгүй (худалдан авахаас
      // өмнөх хуучин эвент) → хасахгүй.
      if (!seg || seg.entries === null) return false;

      // ── Давтан уншуулалт уу ──
      const [from, to] = this.freeWindow(mode, minutes, eventAt);
      const dup = await m.query<unknown[]>(
        `SELECT 1 FROM access_events
          WHERE member_id = $1
            AND entry_membership_id IS NOT NULL
            AND event_at > $2 AND event_at < $3
            AND id <> $4
          LIMIT 1`,
        [memberId, from, to, eventId],
      );
      if (dup.length) return false;

      const head = rows.find((r) => r.id === seg.headId)!;
      if (head.entriesUsed >= seg.entries) {
        // Терминал хаалтыг хүлээн авахаас өмнө нэвтэрсэн — тоолох юм алга.
        this.log.warn(
          `№${member.memberNo}: оролт дууссан ч нэвтэрсэн (терминал хоцорсон)`,
        );
        return false;
      }

      head.entriesUsed += 1;
      await m.update(AccessEvent, { id: eventId }, { entryMembershipId: head.id });

      const exhausted = head.entriesUsed >= seg.entries;
      if (exhausted) {
        /*
         * ★ ХААХ АГШИН = сүүлийн оролт + давтан уншуулах цонх.
         *
         * Шууд хаавал сүүлийн оролтоороо орсон хүн ус авахаар гараад
         * буцаж орж чадахгүй — бусад оролтод үнэгүй байсан зүйл.
         */
        const close = this.closeAt(mode, minutes, eventAt);
        head.closedAt = close < seg.naturalEnd ? close : seg.naturalEnd;
        head.endsAt = head.closedAt;
      }
      await ledger.save(head);

      if (exhausted) {
        // Дараагийн мөрүүд (хойш дараалсан багц) эрт эхэлнэ.
        const after = replayLedger(rows, this.tz, rows[0].startsAt);
        member.accessEndsAt = after[after.length - 1].end;
        await m.getRepository(Member).save(member);
        await this.outbox.enqueue(
          {
            topic: DEVICE_TOPICS.SET_VALIDITY,
            payload: { memberId },
            groupKey: memberGroup(memberId),
          },
          m,
        );
        // ⚠ `loopy.extend` ИЛГЭЭХГҮЙ — тэр нь «эрх сунгагдлаа» мэдэгдэл
        // явуулдаг. Дуусах огноо доорх `loopy.fields`-ээр шинэчлэгдэнэ.
        this.log.log(
          `№${member.memberNo} ${member.name}: оролт дууслаа (${seg.entries}/${seg.entries}) → ` +
            `эрх ${member.accessEndsAt.toISOString()} хүртэл`,
        );
      }
      // Карт дээрх «үлдсэн оролт» шинэчлэгдэнэ.
      await this.outbox.enqueue(
        {
          topic: LOYALTY_TOPICS.FIELDS,
          payload: { memberId },
          groupKey: loyaltyGroup(memberId),
        },
        m,
      );
      return true;
    });
  }

  /** Энэ уншуулалтыг ҮНЭГҮЙ болгох хасагдсан уншуулалтын цонх. */
  private freeWindow(
    mode: EntryChargeMode,
    minutes: number,
    t: Date,
  ): [Date, Date] {
    if (mode === 'day') {
      return [
        new Date(startOfLocalDay(t, this.tz).getTime() - 1),
        new Date(endOfLocalDay(t, this.tz).getTime() + 1),
      ];
    }
    // ⚠ ХОЁР ТАЛД нь — эвент хоцорч, дараалал алдагдан ирдэг (татагч).
    const w = Math.max(
      ENTRY_DEDUPE_FLOOR_MS,
      mode === 'window' ? minutes * 60_000 : 0,
    );
    return [new Date(t.getTime() - w), new Date(t.getTime() + w)];
  }

  private closeAt(mode: EntryChargeMode, minutes: number, t: Date): Date {
    if (mode === 'day') return endOfLocalDay(t, this.tz);
    const w = Math.max(
      ENTRY_DEDUPE_FLOOR_MS,
      mode === 'window' ? minutes * 60_000 : 0,
    );
    return new Date(t.getTime() + w);
  }
}
