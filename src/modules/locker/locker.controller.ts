import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CreateLockerDto,
  IssueLockerDto,
  ListAssignmentsDto,
  ListLockersDto,
  ReturnLockerDto,
  UpdateLockerDto,
} from './dto/locker.dto';
import { LockerService } from './locker.service';

@ApiTags('lockers')
@ApiBearerAuth('access-token')
@Controller()
export class LockerController {
  constructor(private readonly lockers: LockerService) {}

  // ── Ресепшний үндсэн үйлдлүүд ──

  @Get('lockers/board')
  @ApiOperation({
    summary: 'Шүүгээний самбар — өрөө тус бүрийн одоогийн төлөв',
    description:
      'Төлөв: free · daily (өдрийн түлхүүр гарсан) · rented · overdue · disabled',
  })
  @ApiQuery({ name: 'zone', required: false, example: 'Эрэгтэй' })
  board(@Query('zone') zone?: string) {
    return this.lockers.board(zone);
  }

  @Post('lockers/issue')
  @ApiOperation({
    summary: 'Түлхүүр олгох',
    description:
      'ӨРӨӨ + ДУГААР хосоор заана (эрэгтэй/эмэгтэй өрөөний дугаарлалт тусдаа). ' +
      'Шүүгээ бүртгэлгүй бол автоматаар үүснэ.',
  })
  issue(
    @Body() dto: IssueLockerDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.lockers.issue(dto, user, req.ip);
  }

  @Post('lockers/return')
  @ApiOperation({ summary: 'Түлхүүр буцааж авах' })
  return(
    @Body() dto: ReturnLockerDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.lockers.return(dto, user, req.ip);
  }

  @Get('lockers/stats')
  @ApiOperation({ summary: 'Гарсан түлхүүр, хугацаа хэтэрсэн түрээсийн тоо' })
  stats() {
    return this.lockers.stats();
  }

  // ── Жагсаалтууд ──

  @Get('lockers')
  @ApiOperation({ summary: 'Шүүгээнүүд (хуудаслалттай)' })
  list(@Query() q: ListLockersDto) {
    return this.lockers.listLockers(q);
  }

  @Get('locker-assignments')
  @ApiOperation({
    summary: 'Түлхүүр олголтын түүх (хуудаслалттай)',
    description: 'outstanding=true → одоо гарсан. overdue=true → хугацаа хэтэрсэн.',
  })
  assignments(@Query() q: ListAssignmentsDto) {
    return this.lockers.listAssignments(q);
  }

  /**
   * Түлхүүр буцаагаагүй гишүүнд ГАРААР сануулга илгээх.
   *
   * Автоматаар БИШ: «буцаагаагүй» өгөгдөл нь ресепшн бүртгээгүйгээс ч
   * үүсдэг тул ажилтан баталсан үедээ л дарна.
   */
  @Roles(Role.MANAGER)
  @Post('locker-assignments/:id/remind')
  @ApiOperation({ summary: 'Түлхүүр буцаах сануулга илгээх' })
  remind(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lockers.remind(id, user);
  }

  @Get('members/:id/lockers')
  @ApiOperation({ summary: 'Гишүүний шүүгээний түүх' })
  byMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ListAssignmentsDto,
  ) {
    q.memberId = id;
    return this.lockers.listAssignments(q);
  }

  @Get('members/:id/locker-zone')
  @ApiOperation({
    summary: 'Санал болгох өрөө — сүүлд ашигласнаар, эс бөгөөс хүйсээр',
  })
  async suggestZone(@Param('id', ParseUUIDPipe) id: string) {
    return this.lockers.suggestZoneFor(id);
  }

  // ── Удирдлага ──

  @Roles(Role.MANAGER)
  @Post('lockers')
  @ApiOperation({ summary: 'Шүүгээ гараар бүртгэх' })
  create(@Body() dto: CreateLockerDto) {
    return this.lockers.create(dto);
  }

  @Roles(Role.MANAGER)
  @Patch('lockers/:id')
  @ApiOperation({ summary: 'Тэмдэглэл, эвдэрсэн эсэхийг засах' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLockerDto) {
    return this.lockers.update(id, dto);
  }
}
