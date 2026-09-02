import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CreateGlobalFreezeDto,
  CreateMemberFreezeDto,
  EndFreezeDto,
} from './dto/freeze.dto';
import { FreezeService } from './freeze.service';

@ApiTags('freeze')
@ApiBearerAuth('access-token')
@Controller('freezes')
export class FreezeController {
  constructor(private readonly svc: FreezeService) {}

  @Get()
  @ApiOperation({ summary: 'Сүүлийн чөлөөнүүд' })
  recent() {
    return this.svc.recent();
  }

  @Get('member/:memberId')
  @ApiOperation({ summary: 'Гишүүний чөлөөний байдал ба түүх' })
  ofMember(@Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.svc.ofMember(memberId);
  }

  /**
   * Хувь хүний чөлөө — нэвтрэлт ХААГДАНА.
   *
   * Менежерийн эрх: ресепшн бүгдэд өгвөл орлого алдагдана.
   */
  @Roles(Role.MANAGER)
  @Post('member')
  @ApiOperation({ summary: 'Гишүүнд чөлөө олгох' })
  createMember(
    @Body() dto: CreateMemberFreezeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.createMember(dto, user);
  }

  @Roles(Role.MANAGER)
  @Post(':id/end')
  @ApiOperation({ summary: 'Чөлөөг ГАРААР эрт дуусгах' })
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndFreezeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.end(id, user, dto.reason);
  }

  /**
   * Баярын чөлөө — БҮХ идэвхтэй гишүүнд.
   *
   * ⚠ ADMIN эрх: 337 гишүүний хугацааг нэг товшилтоор сунгах үйлдэл.
   */
  @Roles(Role.ADMIN)
  @Post('global')
  @ApiOperation({ summary: 'Баярын чөлөө — бүх идэвхтэй гишүүнд' })
  createGlobal(
    @Body() dto: CreateGlobalFreezeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.createGlobal(dto, user);
  }
}
