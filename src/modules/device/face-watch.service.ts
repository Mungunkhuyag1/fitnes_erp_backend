import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { Member } from '../member/member.entity';
import { DEVICE_GATEWAY, type DeviceGateway } from './device.gateway';

/**
 * Царай бүртгэгдсэн эсэхийг хянана.
 *
 * Царайг терминал дээр ӨӨР ДЭЭР НЬ бүртгэдэг (docs/01 §6.1, шийдвэр 4) тул
 * үүлэн тал «бүртгэгдсэн үү» гэдгийг өөрөө мэдэх боломжгүй — асууж мэднэ.
 *
 * Зөвхөн ХҮЛЭЭГДЭЖ БУЙ хүмүүсийг асууна: жагсаалт хоосон бол огт хүсэлт
 * илгээхгүй (docs/04-agent-design.md §7).
 */
@Injectable()
export class FaceWatchService {
  private readonly log = new Logger(FaceWatchService.name);
  private running = false;

  constructor(
    @Inject(DEVICE_GATEWAY) private readonly device: DeviceGateway,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly config: ConfigService,
  ) {}

  @Interval('face-watch', Number(process.env.FACE_WATCH_INTERVAL_MS ?? 30_000))
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.check();
    } catch (e) {
      // Терминал офлайн байх нь хэвийн — дараагийн давталтад дахин оролдоно.
      this.log.debug(`Царайн шалгалт алгаслаа: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async check(): Promise<number> {
    const waiting = await this.members.find({
      where: {
        faceEnrolled: false,
        status: Not(MemberStatus.CANCELLED),
        // Терминал руу нэг ч удаа бичигдээгүй бол асуух утгагүй.
        // ⚠ `Not(In([null]))` бичвэл SQL нь `NOT (col IN (NULL))` болж ХЭЗЭЭ Ч
        // үнэн болдоггүй — заавал `Not(IsNull())`.
        hikSyncedAt: Not(IsNull()),
      },
      select: { id: true, memberNo: true, name: true },
      take: 100,
    });
    if (!waiting.length) return 0;

    const status = await this.device.faceStatus(waiting.map((m) => m.memberNo));
    /*
     * ⚠ `status[no]` нь ОБЪЕКТ. Түүнийг шууд үнэн/худал гэж шалгавал
     * объект бүр truthy тул хүлээгдэж буй БҮХ гишүүнийг «бүртгэгдсэн»
     * гэж тэмдэглэнэ.
     */
    const enrolled = waiting.filter((m) => status[m.memberNo]?.enrolled);
    if (!enrolled.length) return 0;

    const now = new Date();
    await this.members.update(
      { id: In(enrolled.map((m) => m.id)) },
      { faceEnrolled: true, faceEnrolledAt: now },
    );

    /*
     * Царайн зургийн ЗАМ — хост нь тохиргоонд, зам нь мөрөнд.
     *
     * ⚠ Бүтэн хаягийг хадгалж болохгүй: терминалын IP нь DHCP-ээр
     * солигдож, ирээдүйд домэйн болж мэднэ. Байтыг нь ч хадгалахгүй —
     * харуулах агшинд терминалаас нь татна.
     *
     * Гишүүн бүрд тусад нь бичнэ (зам нь өөр өөр) ч энэ нь ховор
     * үйлдэл: царай нэг л удаа бүртгэгдэнэ.
     */
    for (const m of enrolled) {
      const path = status[m.memberNo]?.path;
      if (!path) continue;
      await this.members.update(
        { id: m.id },
        { photoPath: path, photoAt: now },
      );
    }
    this.log.log(
      `Царай бүртгэгдэв: ${enrolled.map((m) => `${m.name}(№${m.memberNo})`).join(', ')}`,
    );
    return enrolled.length;
  }
}
