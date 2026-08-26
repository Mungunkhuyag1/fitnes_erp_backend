import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  ExtendMembershipDto,
  ListMembershipsDto,
  MemberActionDto,
  ReverseMembershipDto,
} from './dto/membership.dto';
import { MembershipService } from './membership.service';

@ApiTags('memberships')
@ApiBearerAuth('access-token')
@Controller()
export class MembershipController {
  constructor(private readonly memberships: MembershipService) {}

  // ── Гишүүн дээрх үйлдлүүд ──

  @Post('members/:id/extend')
  @ApiOperation({
    summary: 'Эрх сунгах (бэлэн / гараар)',
    description:
      'Ресепшн ажилтан `allow_reception_extend` тохиргоо асаалттай үед л хийж чадна.',
  })
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendMembershipDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.memberships.extendByStaff(id, dto, user, req.ip);
  }

  @Roles(Role.MANAGER)
  @Post('members/:id/suspend')
  @ApiOperation({ summary: 'Түр зогсоох (терминал дээр эрх унтарна)' })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MemberActionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.memberships.suspend(id, dto.reason, user, req.ip);
  }

  @Roles(Role.MANAGER)
  @Post('members/:id/resume')
  @ApiOperation({ summary: 'Сэргээх' })
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MemberActionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.memberships.resume(id, dto.reason, user, req.ip);
  }

  @Roles(Role.MANAGER)
  @Post('members/:id/cancel')
  @ApiOperation({
    summary: 'Цуцлах — терминалаас устгана (царай хамт)',
  })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MemberActionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.memberships.cancel(id, dto.reason, user, req.ip);
  }

  @Get('members/:id/memberships')
  @ApiOperation({ summary: 'Гишүүний худалдан авалтын дэвтэр' })
  byMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ListMembershipsDto,
  ) {
    q.memberId = id;
    return this.memberships.list(q);
  }

  // ── Гишүүнчлэлийн жагсаалт ──

  @Get('memberships')
  @ApiOperation({ summary: 'Бүх худалдан авалт (хуудаслалттай)' })
  list(@Query() q: ListMembershipsDto) {
    return this.memberships.list(q);
  }

  @Roles(Role.MANAGER)
  @Post('memberships/:id/reverse')
  @ApiOperation({
    summary: 'Буцаах — мөрийг устгахгүй, эрхийг дэвтрээс дахин тооцно',
  })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseMembershipDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.memberships.reverse(id, dto.reason, user, req.ip);
  }
}
