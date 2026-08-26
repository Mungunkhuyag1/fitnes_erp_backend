import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { Member } from '../member/member.entity';
import { OutboxService } from '../outbox/outbox.service';
import { DEVICE_TOPICS, memberGroup } from './device-sync.service';

export interface DeviceReconcileResult {
  ran: boolean;
  reason?: string;
  /** Дахин бичихээр дараалалд оруулсан гишүүн. */
  requeued: number;
  /** Терминалаас устгахаар дараалалд оруулсан (цуцлагдсан гишүүд). */
  requeuedDelete: number;
}

/**
 * Терминалын шөнийн тулгалт — амжилтгүй болсон бичилтийг өөрөө нөхнө.
 *
 * ЯАГААД ХЭРЭГТЭЙ ВЭ:
 *
 * Outbox нь 5 удаа дахин оролдоод (production-д ~8.6 цаг) бүтэхгүй бол
 * мөрийг `failed` болгоно. `failed` төлөв нь ӨӨРӨӨ хэзээ ч арилдаггүй —
 * хүн гараар `/sync` дээрээс дарах хүртэл гишүүн терминал дээр буруу
 * төлөвтэй үлдэнэ.
 *
 * Loopy тал энэ асуудалгүй: 04:00-ийн тулгалт нь бодит байдлыг харьцуулж
 * ШИНЭ мөр үүсгэдэг. Терминалд ижил зүйл байгаагүй — энэ нь тэр
 * тэгш бус байдлыг арилгана.
 *
 * АРГА: `hik_sync_error` нь терминалын үйлдэл унасан гишүүн бүр дээр
 * тэмдэглэгддэг (амжилттай болмогц автоматаар арилна). Тиймээс тэр
 * талбар нь «засах шаардлагатай» жагсаалт болно.
 */
@Injectable()
export class DeviceReconcileService {
  private readonly log = new Logger(DeviceReconcileService.name);
  private running = false;

  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Өдөр бүр 03:00 — Loopy тулгалтаас (04:00) НЭГ ЦАГИЙН өмнө.
   *
   * Терминал нь фитнесийн дотоод сүлжээнд байдаг тул шөнө найдвартай
   * холбогдоно. Мөн 09:00-ийн сануулга илгээхээс өмнө бүх зүйл цэгцэрсэн
   * байх нь зөв.
   */
  @Cron('0 3 * * *', { name: 'device-reconcile', timeZone: 'Asia/Ulaanbaatar' })
  async tick(): Promise<DeviceReconcileResult> {
    return this.run();
  }

  async run(): Promise<DeviceReconcileResult> {
    if (this.running) {
      return { ran: false, reason: 'Аль хэдийн ажиллаж байна', requeued: 0, requeuedDelete: 0 };
    }
    this.running = true;
    try {
      return await this.doRun();
    } finally {
      this.running = false;
    }
  }

  private async doRun(): Promise<DeviceReconcileResult> {
    // `Not(IsNull())` — `Not(In([null]))` гэж бичвэл SQL нь
    // `NOT (col IN (NULL))` болж ХЭЗЭЭ Ч үнэн болохгүй (өмнө тулгарсан алдаа).
    const rows = await this.members.find({
      where: { hikSyncError: Not(IsNull()) },
      select: { id: true, memberNo: true, name: true, status: true },
    });

    if (!rows.length) {
      return { ran: true, requeued: 0, requeuedDelete: 0 };
    }

    let requeued = 0;
    let requeuedDelete = 0;

    for (const m of rows) {
      // ★ Цуцлагдсан гишүүнийг ДАХИН ҮҮСГЭХГҮЙ.
      //
      // `USER_UPSERT` нь хэрэглэгчийг терминал дээр үүсгэдэг. Цуцлагдсан
      // гишүүнд түүнийг явуулбал устгасан хүн буцаж үүсэх ба нэвтрэх
      // эрхтэй болж болзошгүй. Тэдэнд УСТГАХ командыг дахин илгээнэ.
      const cancelled = m.status === MemberStatus.CANCELLED;
      await this.outbox.enqueue({
        topic: cancelled ? DEVICE_TOPICS.USER_DELETE : DEVICE_TOPICS.USER_UPSERT,
        payload: { memberId: m.id },
        groupKey: memberGroup(m.id),
      });
      if (cancelled) requeuedDelete++;
      else requeued++;
    }

    this.log.warn(
      `Терминалын тулгалт: ${requeued} дахин бичив, ` +
        `${requeuedDelete} устгахаар дараалалд оров`,
    );
    return { ran: true, requeued, requeuedDelete };
  }
}
