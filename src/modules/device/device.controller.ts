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
import { DeviceConnectionService } from './device-connection.service';
import { DeviceDiagnosticsService } from './device-diagnostics.service';
import { DeviceService } from './device.service';
import { DirectDeviceGateway } from './direct-device.gateway';
import { UpdateConnectionDto } from './dto/connection.dto';

@ApiTags('devices')
@ApiBearerAuth('access-token')
@Controller('devices')
export class DeviceController {
  constructor(
    private readonly devices: DeviceService,
    private readonly audit: AuditService,
    private readonly diag: DeviceDiagnosticsService,
    private readonly addr: DeviceConnectionService,
    private readonly direct: DirectDeviceGateway,
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

  /** Одоогийн холболтын тохиргоо — дэлгэцэд (нууц үггүй). */
  @Get('connection')
  @ApiOperation({ summary: 'Терминалын холболтын тохиргоо' })
  connection() {
    return this.addr.current();
  }

  /**
   * Холболтын тохиргоог дэлгэцээс хадгална.
   *
   * ЯАГААД ДЭЛГЭЦЭЭС ВЭ: IP нь DHCP-ээр солигдоно, нууц үгийг заалан
   * дээр солино. `.env` дээр байвал ажилтан өөрөө засаж чадахгүй,
   * дахин deploy хүлээх болно.
   *
   * Хадгалсны ДАРАА нэн даруй: gateway-г шинэ тохиргоогоор дахин
   * үүсгээд, терминал руу нэг уншилт хийж БАТАЛГААЖУУЛНА. Ингэснээр
   * ажилтан «хадгаллаа» гэж бодоод буруу тохиргоотой үлдэхгүй.
   */
  @Roles(Role.MANAGER)
  @Patch('connection')
  @ApiOperation({ summary: 'Терминалын холболтыг тохируулж, шалгах' })
  async setConnection(
    @Body() dto: UpdateConnectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.addr.saveConnection(dto);
    await this.audit.record({
      staffUserId: user.id,
      action: 'device.setConnection',
      entity: 'device',
      entityId: 'terminal',
      // ⚠ Нууц үгийг аудитад БИЧИХГҮЙ — зөвхөн солигдсон эсэхийг.
      after: {
        ip: dto.ip,
        port: dto.port,
        user: dto.user,
        https: dto.https,
        passwordChanged: Boolean(dto.password),
      },
    });

    await this.direct.reconnect();
    const test = await this.diag.test();
    return { ...(await this.addr.current()), test };
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
