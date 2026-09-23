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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CreateMemberDto,
  ListMembersDto,
  SetStaffUserDto,
  UpdateMemberDto,
} from './dto/member.dto';
import { MemberService } from './member.service';
import { AuditService } from '../audit/audit.service';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';

@ApiTags('members')
@ApiBearerAuth('access-token')
@Controller('members')
export class MemberController {
  constructor(
    private readonly members: MemberService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Гишүүд — хайлт, шүүлтүүр, хуудаслалт',
    description:
      'q (нэр/утас), status, expiring=N, faceEnrolled, hasCard, syncError, sort, page, limit',
  })
  list(@Query() q: ListMembersDto) {
    return this.members.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Гишүүний дэлгэрэнгүй' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.detail(id);
  }

  @Post()
  @ApiOperation({ summary: 'Гишүүн бүртгэх' })
  create(@Body() dto: CreateMemberDto) {
    return this.members.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Гишүүний мэдээлэл засах' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return this.members.update(id, dto);
  }

  @Post(':id/resync')
  @ApiOperation({ summary: 'Терминал руу дахин бичих (синк алдааны дараа)' })
  resync(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.resync(id);
  }

  /**
   * Терминал дээр царай уншуулах.
   *
   * ⚠ УДААН хариу (хүн терминалын өмнө зогсохыг хүлээнэ). Дуудагч тал
   * хүсэлтээ богино хугацаагаар таслах ёсгүй.
   *
   * Эрх: ресепшн ч хийнэ — `resync`-тэй ижил. Энэ бол шинэ гишүүн
   * бүртгэх ердийн алхам бөгөөд менежер хүлээвэл хийгдэхгүй үлдэнэ
   * (docs/09-role-matrix.md).
   */
  @Post(':id/face')
  @ApiOperation({ summary: 'Терминал дээр царай уншуулах (алсаас эхлүүлнэ)' })
  async enrollFace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const r = await this.members.enrollFace(id);
    /*
     * Зөвхөн АМЖИЛТЫГ аудитад бичнэ. Бүтэлгүй оролдлого (хүн ирээгүй)
     * нь хэвийн бөгөөд өдөрт хэдэн ч удаа гарч болно — аудитыг дүүргэвэл
     * жинхэнэ чухал мөрүүд түүн дотор алга болно.
     */
    await this.audit.record({
      staffUserId: user.id,
      action: 'member.faceEnroll',
      entity: 'member',
      entityId: id,
      after: { faceEnrolledAt: r.faceEnrolledAt },
    });
    return r;
  }

  /**
   * Явж буй уншуулалтыг зогсоох.
   *
   * ⚠ Браузер хүсэлтээ таслахад сервер МЭДЭХГҮЙ — терминалтай ярьсаар
   * байх ба түгжээ минут хүртэл суларахгүй. Дараагийн хүнийг оруулах
   * гэтэл «өөр хүний царай уншуулж байна» гэж зогсох тул ил дуудлага
   * хэрэгтэй.
   *
   * Аудитад бичихгүй: цуцлалт нь юу ч өөрчилдөггүй.
   */
  @Post(':id/face/cancel')
  @ApiOperation({ summary: 'Царай уншуулахыг зогсоох' })
  cancelFace(@Param('id', ParseUUIDPipe) _id: string) {
    return this.members.cancelFace();
  }

  /**
   * Ажилтны данстай холбох — тайлангаас хасах тэмдэг.
   *
   * ADMIN эрхтэй: энэ нь тайлангийн тоог өөрчлөдөг тул ресепшнээс
   * санамсаргүй дарагдах ёсгүй.
   */
  @Roles(Role.ADMIN)
  @Patch(':id/staff-user')
  @ApiOperation({ summary: 'Гишүүнийг ажилтны данстай холбох / салгах' })
  async setStaffUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStaffUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    const before = await this.members.detail(id);
    const r = await this.members.setStaffUser(id, dto.staffUserId ?? null);
    await this.audit.record({
      staffUserId: user.id,
      action: 'member.linkStaff',
      entity: 'member',
      entityId: id,
      before: { staffUser: before.staffUser?.name ?? null },
      after: { staffUser: r.staffUser?.name ?? null },
    });
    return r;
  }

  @Roles(Role.MANAGER)
  @Post(':id/pay-token/rotate')
  @ApiOperation({ summary: 'Төлбөрийн холбоосыг сэлгэх' })
  rotatePayToken(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.rotatePayToken(id);
  }
}
