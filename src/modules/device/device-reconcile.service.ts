import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Member } from '../member/member.entity';
import { OutboxService } from '../outbox/outbox.service';
import { DEVICE_TOPICS, memberGroup } from './device-sync.service';
import { CRON, SCHEDULE_TZ } from '../../config/schedule';

export interface DeviceReconcileResult {
  ran: boolean;
  reason?: string;
  /** Дахин бичихээр дараалалд оруулсан гишүүн. */
  requeued: number;
}

/**
 * Терминалын ӨГЛӨӨНИЙ тулгалт — амжилтгүй болсон бичилтийг өөрөө нөхнө.
 *
 * ЯАГААД ХЭРЭГТЭЙ ВЭ:
 *
 * Outbox нь 5 оролдлогын дараа мөрийг `failed` болгоно. ⚠ Хоцролт нь
 * `60,300,1800,7200,21600` боловч 5 дахь АЛДАА нь эцсийн тул ЗӨВХӨН
 * эхний дөрөв хэрэглэгддэг: бүх оролдлого ~2 ЦАГ 36 МИНУТ дотор
 * дуусна (21600 хэзээ ч хүрэхгүй). Өөрөөр хэлбэл 00:30-д үүссэн
 * бичилт 03:06 гэхэд үүрд унтарна — заал нээхээс 4 цагийн өмнө.
 *
 * `failed` төлөв нь ӨӨРӨӨ хэзээ ч арилдаггүй — хүн гараар `/sync`
 * дээрээс дарах хүртэл гишүүн терминал дээр буруу төлөвтэй үлдэнэ.
 * Тиймээс ӨГЛӨӨ туннель дээшилсэн хойно энэ нь тэднийг цуглуулна.
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
   * Өдөр бүр ӨГЛӨӨ 07:30 — терминалын тулгалтаас (07:00) ХОЙНО.
   *
   * ★ ЗАЛРУУЛГА — «терминал шөнө найдвартай холбогдоно» нь БУРУУ байв
   *
   * Энд өмнө «терминал дотоод сүлжээнд байдаг тул шөнө найдвартай
   * холбогдоно» гэж бичсэн, цаг нь 03:00 байв. Бодит байдал ТЭС ӨӨР:
   * терминал руу зөвхөн заалны Windows PC дээрх `cloudflared`-аар
   * хүрдэг ба заал хаагдахад тэр PC УНТДАГ. Өөрөөр хэлбэл шөнө бол
   * холболт байхгүй байх нь БАТАЛГААТАЙ хамгийн цаг байв.
   *
   * 07:00-ийн тулгалт зөрүүг дараалалд оруулсны дараа энэ нь үлдсэн
   * `hik_sync_error`-уудыг дахин оролдоно. 09:00-ийн сануулга
   * явахаас өмнө. Цагийг `CRON_DEVICE_RECONCILE`-аар өөрчилж болно.
   */
  @Cron(CRON.DEVICE_RECONCILE, { name: 'device-reconcile', timeZone: SCHEDULE_TZ })
  async tick(): Promise<DeviceReconcileResult> {
    const r = await this.run();
    // Чимээгүй `ran: false` нь өмнө нь шөнийн бүтэлгүйтлийг нуудаг байв.
    if (!r.ran) this.log.warn(`Терминалын нөхөлт ажиллаагүй: ${r.reason ?? '—'}`);
    return r;
  }

  async run(): Promise<DeviceReconcileResult> {
    if (this.running) {
      return { ran: false, reason: 'Аль хэдийн ажиллаж байна', requeued: 0 };
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
      return { ran: true, requeued: 0 };
    }

    let requeued = 0;

    for (const m of rows) {
      /*
       * ⚠ ЭНД УСТГАХ КОМАНД БАЙХГҮЙ.
       *
       * Урьд нь цуцлагдсан гишүүнд `USER_DELETE` илгээдэг байв. Одоо
       * бүгдэд `USER_UPSERT` — цуцлагдсаных нь `deviceValidity`-аар
       * `enable=false`, дуусах огноо нь өнгөрсөн болж бичигдэнэ.
       *
       * Өөрөөр хэлбэл цуцлагдсан хүн терминал дээр үлдэх ч нэвтэрч
       * чадахгүй. Автомат ажил терминалаас юу ч арилгахгүй.
       */
      await this.outbox.enqueue({
        topic: DEVICE_TOPICS.USER_UPSERT,
        payload: { memberId: m.id },
        groupKey: memberGroup(m.id),
      });
      requeued++;
    }

    this.log.warn(`Терминалын тулгалт: ${requeued} гишүүн дахин бичигдэнэ`);
    return { ran: true, requeued };
  }
}
