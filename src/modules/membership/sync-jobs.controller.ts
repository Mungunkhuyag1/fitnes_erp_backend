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

  /**
   * Түүхэн ирцийг терминалаас буцааж татах — нэг удаагийн импорт.
   *
   * ⚠ БИЧИХГҮЙ. `dedupe_key` давхардлыг зогсоох тул дахин
   * ажиллуулахад аюулгүй.
   */
  @Roles(Role.ADMIN)
  @Post('acs-backfill')
  @ApiOperation({ summary: 'Түүхэн ирц татах (хоногоор)' })
  async backfill(@Body() body: { days?: number }, @CurrentUser() user: AuthUser) {
    const n = Number(body.days);
    // ⚠ Дээд хязгаар 180: терминал өдөрт нэг дуудлага авна, түүнээс
    // урт бол хүсэлт хэдэн минут үргэлжилж timeout болно.
    if (!Number.isInteger(n) || n < 1 || n > 180) {
      throw new BadRequestException('days нь 1–180 хооронд бүхэл тоо байна');
    }
    const r = await this.acsPoller.backfill(n);
    await this.audit.record({
      staffUserId: user.id,
      action: 'access.backfill',
      entity: 'access_event',
      after: { days: n, fetched: r.fetched, ingested: r.ingested },
    });
    return r;
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

  // ── Мөр тус бүрийн үйлдэл — ажилтан ЧИГЛЭЛИЙГ сонгоно ──
  //
  // ⚠ «Бүгдийг устга» гэсэн бөөнөөр устгах товч ЗОРИУДААР байхгүй.
  // Терминал дээрх танихгүй хэрэглэгч бүр өөр шалтгаантай — нэг нь
  // ажилтан, нөгөө нь бүртгэл алдагдсан гишүүн байж болно. Бөөнөөр
  // устгах нь тэр ялгааг харахгүйгээр шийдэхэд хүргэнэ.

  /** WinFit → терминал: гишүүнийг терминал дээр дарж бичих. */
  @Roles(Role.MANAGER)
  @Post('device-audit/push')
  @ApiOperation({ summary: 'WinFit → терминал (нэг гишүүн)' })
  async auditPush(
    @Body() body: { employeeNo?: number },
    @CurrentUser() user: AuthUser,
  ) {
    const no = this.employeeNo(body.employeeNo);
    const r = await this.deviceAuditSvc.push(no);
    await this.audit.record({
      staffUserId: user.id,
      action: 'device.auditPush',
      entity: 'device',
      entityId: String(no),
      after: { employeeNo: no },
    });
    return r;
  }

  /**
   * Терминал → WinFit: терминалын утгыг WinFit рүү авах.
   *
   * ⚠ Хэвийн урсгалын ЭСРЭГ чиглэл — эрхийн огноог терминалаас авах нь
   * төлбөрийн бүртгэлтэй зөрчилдөж болно. Тиймээс ADMIN эрхтэй.
   */
  @Roles(Role.ADMIN)
  @Post('device-audit/pull')
  @ApiOperation({ summary: 'Терминал → WinFit (нэг хэрэглэгч)' })
  async auditPull(
    @Body() body: { employeeNo?: number },
    @CurrentUser() user: AuthUser,
  ) {
    const no = this.employeeNo(body.employeeNo);
    const r = await this.deviceAuditSvc.pull(no);
    await this.audit.record({
      staffUserId: user.id,
      action: 'device.auditPull',
      entity: 'member',
      entityId: r.memberId,
      after: { employeeNo: no, name: r.name, action: r.action },
    });
    return r;
  }

  /**
   * Терминал дээрх БҮХ хүнийг WinFit рүү авчрах — нэг удаагийн импорт.
   *
   * ⚠ БИЧИХГҮЙ. Зөвхөн терминалаас уншиж WinFit-д гишүүн үүсгэнэ.
   * Терминал дээр юу ч өөрчлөгдөхгүй.
   *
   * ⚠ Байгаа гишүүнийг ХӨНДӨХГҮЙ — зөвхөн WinFit-д байхгүйг нь
   * үүсгэнэ. Дахин ажиллуулахад аюулгүй (идемпотент).
   */
  @Roles(Role.ADMIN)
  @Post('device-audit/pull-all')
  @ApiOperation({ summary: 'Терминал → WinFit (бүх хэрэглэгч, нэг удаа)' })
  async auditPullAll(@CurrentUser() user: AuthUser) {
    const r = await this.deviceAuditSvc.pullAll();
    await this.audit.record({
      staffUserId: user.id,
      action: 'device.auditPullAll',
      entity: 'member',
      after: {
        deviceTotal: r.deviceTotal,
        created: r.created,
        skipped: r.skipped,
        failed: r.failed.length,
      },
    });
    return r;
  }


  private employeeNo(v: unknown): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
      throw new BadRequestException('employeeNo буруу байна');
    }
    return n;
  }
}
