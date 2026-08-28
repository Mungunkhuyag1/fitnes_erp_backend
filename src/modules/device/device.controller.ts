import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import { DeviceAddressService } from './device-address.service';
import { DeviceDiagnosticsService } from './device-diagnostics.service';
import { DeviceService } from './device.service';

@ApiTags('devices')
@ApiBearerAuth('access-token')
@Controller('devices')
export class DeviceController {
  constructor(
    private readonly devices: DeviceService,
    private readonly audit: AuditService,
    private readonly diag: DeviceDiagnosticsService,
    private readonly addr: DeviceAddressService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Терминалуудын жагсаалт' })
  list() {
    return this.devices.list();
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Терминалын үзүүлэлт — уншуулалт, татгалзал, царай, дараалал',
  })
  @ApiQuery({ name: 'days', required: false })
  stats(@Query('days') days?: string) {
    // 1–90 хоног. Хязгаараас гарсан утга ирвэл 7 хоног руу унана —
    // `days=99999` гэх мэт хүсэлт санг хөдөлгөхгүй.
    const n = Number(days);
    return this.devices.stats(Number.isFinite(n) && n >= 1 && n <= 90 ? n : 7);
  }

  @Get('ping')
  @ApiOperation({ summary: 'Терминалтай холбогдож үзэх' })
  ping() {
    return this.devices.ping();
  }

  /** Одоогийн хаяг, эх сурвалж, дэд сүлжээ — дэлгэцэд. */
  @Get('address')
  @ApiOperation({ summary: 'Терминалын хаягийн төлөв' })
  address() {
    return this.addr.current();
  }

  /** Хаягийг гараар тавих — автомат хайлт бүтэлгүйтсэн үед. */
  @Roles(Role.MANAGER)
  @Patch('address')
  @ApiOperation({ summary: 'Терминалын хаягийг гараар оруулах' })
  async setAddress(
    @Body() body: { ip?: string },
    @CurrentUser() user: AuthUser,
  ) {
    await this.addr.setManual(String(body.ip ?? '').trim());
    await this.audit.record({
      staffUserId: user.id,
      action: 'device.setAddress',
      entity: 'device',
      entityId: 'terminal',
      after: { ip: body.ip },
    });
    return this.addr.current();
  }

  /**
   * Терминалын IP-г дэд сүлжээнээс ХАЙЖ, DB-д хадгална.
   *
   * ЯАГААД ХЭРЭГТЭЙ ВЭ: фитнесийн router DHCP-ээр хаяг тарааж,
   * терминалын IP хугацаа өнгөрөхөд солигддог. Ажилтан `.env` засаж
   * чадахгүй тул дэлгэцээс дарж шинэчлэх боломжтой байх ёстой.
   *
   * ⚠ Сканнер НЭВТРЭХГҮЙ — зөвхөн `401 + Digest` хариуг хардаг тул
   * буруу нууц үгийн тоолуурыг хөдөлгөхгүй.
   */
  @Roles(Role.MANAGER)
  @Post('discover')
  @ApiOperation({ summary: 'Терминалын хаягийг сүлжээнээс хайх' })
  @ApiQuery({ name: 'subnet', required: false, description: 'жиш. 192.168.0' })
  discover(@Query('subnet') subnet?: string) {
    return this.addr.discover(subnet);
  }

  /**
   * ISAPI оношилгоо — БҮХ уншилтын дуудлагыг дараалан хийж, түүхий
   * хариуг буцаана. Мөн сервер дээр `probe/` хавтсанд хадгална.
   *
   * ⚠ Зөвхөн УНШИНА. Оношилгоо нь терминалын төлөвийг өөрчлөх ёсгүй.
   */
  @Roles(Role.MANAGER)
  @Get('diagnose')
  @ApiOperation({ summary: 'Терминалын ISAPI оношилгоо' })
  @ApiQuery({ name: 'employeeNo', required: false })
  @ApiQuery({ name: 'eventHours', required: false })
  diagnose(
    @Query('employeeNo') employeeNo?: string,
    @Query('eventHours') eventHours?: string,
  ) {
    return this.diag.run({
      employeeNo: employeeNo ? Number(employeeNo) : undefined,
      eventHours: eventHours ? Number(eventHours) : undefined,
    });
  }

  @Roles(Role.MANAGER)
  @Post(':id/open-door')
  @ApiOperation({
    summary: 'Хаалгыг зайнаас нээх',
    description:
      'Зөвхөн менежерээс дээш. Үйлдэл АУДИТАД бичигдэнэ — хэн, хэзээ ' +
      'нээснийг дараа нь тогтоох боломжтой байх ёстой.',
  })
  async openDoor(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason?: string },
  ) {
    const res = await this.devices.openDoor(id);
    await this.audit.record({
      staffUserId: user.id,
      action: 'device.openDoor',
      entity: 'device',
      entityId: id,
      reason: body?.reason ?? null,
    });
    return res;
  }
}
