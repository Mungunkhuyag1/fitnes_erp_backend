import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import { DeviceService } from './device.service';

@ApiTags('devices')
@ApiBearerAuth('access-token')
@Controller('devices')
export class DeviceController {
  constructor(
    private readonly devices: DeviceService,
    private readonly audit: AuditService,
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
