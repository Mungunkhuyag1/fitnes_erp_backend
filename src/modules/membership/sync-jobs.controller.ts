import { Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { DeviceReconcileService } from '../device/device-reconcile.service';
import { FaceWatchService } from '../device/face-watch.service';
import { MemberService } from '../member/member.service';
import { ReconcileService } from '../loyalty/reconcile.service';
import { ReminderService } from '../loyalty/reminder.service';
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
  ) {}


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
}
