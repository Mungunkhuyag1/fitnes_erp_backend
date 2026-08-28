import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AcsEventPoller } from '../access/acs-event-poller.service';
import { DeviceAuditService } from '../device/device-audit.service';
import { DeviceReconcileService } from '../device/device-reconcile.service';
import { FaceWatchService } from '../device/face-watch.service';
import { MemberService } from '../member/member.service';
import { ReconcileService } from '../loyalty/reconcile.service';
import { ReminderService } from '../loyalty/reminder.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { DEVICE_TOPICS } from '../device/device-sync.service';
import { OutboxService } from '../outbox/outbox.service';
import { MembershipScheduler } from './membership.scheduler';

/**
 * Хуваарьт ажлуудыг ГАРААР ажиллуулах.
 *
 * Хоёр зорилготой: (1) хөгжүүлэлтэд хуваарийг хүлээхгүйгээр турших,
 * (2) ашиглалтад — систем унтарсны дараа гараар нөхөх.
 */
@ApiTags('sync')
@ApiBearerAuth('access-token')
@Roles(Role.ADMIN)
@Controller('sync/run')
export class SyncJobsController {
  constructor(
    private readonly scheduler: MembershipScheduler,
    private readonly faceWatch: FaceWatchService,
    private readonly reminders: ReminderService,
    private readonly reconcile: ReconcileService,
    private readonly members: MemberService,
    private readonly deviceReconcile2: DeviceReconcileService,
    private readonly acsPoller: AcsEventPoller,
    private readonly deviceAuditSvc: DeviceAuditService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}


  /**
   * Терминалаас ирцийг нөхөж татах.
   *
   * Хуваарьт нь 5 минут тутам өөрөө ажилладаг. Энэ товч нь «яг одоо
   * шалгамаар байна» гэсэн тохиолдолд.
   */
  @Post('acs-events')
  @ApiOperation({ summary: 'Терминалаас ирц татах (нөхөх)' })
  pollEvents() {
    return this.acsPoller.run();
  }

  @Post('expire')
  @ApiOperation({ summary: 'Хугацаа дууссан гишүүдийг тэмдэглэх' })
  async expire() {
    return { expired: await this.scheduler.expire() };
  }

  @Post('reminders')
  @ApiOperation({
    summary: 'Эрх дуусах сануулгыг илгээх (Wallet push)',
    description:
      'Картгүй гишүүнд хүрэхгүй — хариуны `skippedNoCard` нь залгах ' +
      'шаардлагатай хүний тоо.',
  })
  sendReminders() {
    return this.reminders.run();
  }

  @Post('resync-all')
  @ApiOperation({
    summary: 'БҮХ гишүүнийг терминал + Loopy руу дахин бичих',
    description:
      'Терминал солих, factory reset, урт тасалдлын дараа. Гишүүн бүрд 2 мөр ' +
      'үүсэх тул ХҮНД ажил — дэлгэц дээр баталгаажуулна. Цуцлагдсан гишүүнийг ' +
      'оруулахгүй.',
  })
  resyncAll() {
    return this.members.resyncAll();
  }

  @Post('device-reconcile')
  @ApiOperation({
    summary: 'Терминалтай тулгах — амжилтгүй бичилтийг дахин оруулах',
    description:
      '`hik_sync_error` тэмдэгтэй гишүүдийг дахин бичихээр дараалалд ' +
      'оруулна. Цуцлагдсан гишүүнд УСТГАХ командыг илгээнэ — дахин ' +
      'үүсгэхгүй. Өдөр бүр 03:00-д автоматаар ажиллана.',
  })
  deviceReconcile() {
    return this.deviceReconcile2.run();
  }

  @Post('loopy-reconcile')
  @ApiOperation({
    summary: 'Loopy-тэй тулгах — алдагдсан карт холбож, огноо засах',
    description:
      'Webhook хүрээгүйн улмаас холбогдоогүй үлдсэн картуудыг утсаар нь ' +
      'олж холбоно. Мөн Loopy дээрх дуусах огноо WinFit-тэй зөрсөн бол ' +
      'дахин бичихээр дараалалд оруулна. ЮУ Ч УСТГАХГҮЙ.',
  })
  loopyReconcile() {
    return this.reconcile.run();
  }

  @Post('face-check')
  @ApiOperation({ summary: 'Царай бүртгэгдсэн эсэхийг шалгах' })
  async faceCheck() {
    return { enrolled: await this.faceWatch.check() };
  }

  // ── Терминалын бүрэн тулгалт ──

  /**
   * Терминал дээрх БҮХ хэрэглэгчийг татаж WinFit-тэй харьцуулна.
   *
   * `device-reconcile`-аас ЯЛГААТАЙ: тэр нь WinFit өөрөө «унасан» гэж
   * мэдэж байгаа гишүүдийг засдаг. Энэ нь WinFit МЭДЭХГҮЙ зөрүүг олно —
   * терминал reset хийгдсэн, хэн нэгэн гараар засварласан, эсвэл гараар
   * хэрэглэгч нэмсэн.
   *
   * ⚠ ЗӨВХӨН УНШИНА. Юу ч бичихгүй.
   */
  @Get('device-audit/diff')
  @ApiOperation({ summary: 'Терминал ↔ WinFit зөрүү (уншина)' })
  deviceAuditDiff() {
    return this.deviceAuditSvc.diff();
  }

  /**
   * Зөрүүг ЗАСНА — WinFit-ийн утгаар дарж бичнэ.
   *
   * ⚠ Терминал дээр илүү байгаа хэрэглэгчийг УСТГАХГҮЙ. Тэд ажилтан,
   * цэвэрлэгч, зочин байж болно — хүн харж шийднэ. Өдөр бүр 02:30-д
   * автоматаар ажиллана.
   */
  @Post('device-audit')
  @ApiOperation({ summary: 'Терминалыг WinFit-ийн утгаар тулгаж засах' })
  deviceAudit() {
    return this.deviceAuditSvc.run();
  }

  /**
   * Терминал дээрх ИЛҮҮ хэрэглэгчийг устгах — ГАРААР баталгаажуулсны дараа.
   *
   * ⚠ Дуудагчийн өгсөн жагсаалтыг ШУУД хэрэглэхгүй: терминалаас дахин
   * тооцоолсон `extras`-тай ТААРСАН дугаарыг л устгана. Дэлгэц нээснээс
   * хойш гишүүн бүртгэгдсэн бол түүний хэрэглэгч санамсаргүй устахгүй.
   */
  @Post('device-audit/remove-extras')
  @ApiOperation({ summary: 'Терминал дээрх илүү хэрэглэгчийг устгах' })
  async removeExtras(
    @Body() body: { employeeNos?: number[] },
    @CurrentUser() user: AuthUser,
  ) {
    const diff = await this.deviceAuditSvc.diff();
    const asked = new Set(body.employeeNos ?? []);
    const safe = diff.extras.filter((e) => asked.has(e.employeeNo));
    if (!safe.length) throw new BadRequestException('Устгах хэрэглэгч алга');

    for (const e of safe) {
      await this.outbox.enqueue({
        topic: DEVICE_TOPICS.USER_DELETE_NO,
        payload: { employeeNo: e.employeeNo },
        // Гишүүнгүй тул `member:` бүлэг ашиглахгүй — өөрийн бүлэгтэй.
        groupKey: `device-user:${e.employeeNo}`,
      });
    }
    await this.audit.record({
      staffUserId: user.id,
      action: 'device.removeExtras',
      entity: 'device',
      entityId: 'terminal',
      after: { removed: safe.map((e) => `${e.employeeNo} ${e.name}`) },
    });
    return { queued: safe.length, users: safe };
  }
}
