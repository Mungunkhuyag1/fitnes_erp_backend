import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  AddPaymentDto,
  CreateYogaCourseDto,
  CreateYogaEnrollmentDto,
  ListYogaCoursesDto,
  MarkAttendanceDto,
  UpdateYogaCourseDto,
  UpdateYogaEnrollmentDto,
} from './dto/yoga.dto';
import { YogaService } from './yoga.service';

/**
 * Йогийн анги, гишүүд, ирц.
 *
 * Эрх: гишүүн бүртгэх, ирц тэмдэглэхийг РЕСЕПШН хийнэ — өдөр тутмын
 * ажил. Ангийн ХУВААРЬ өөрчлөхөд менежер.
 */
@ApiTags('yoga')
@ApiBearerAuth('access-token')
@Controller('yoga')
export class YogaController {
  constructor(private readonly yoga: YogaService) {}

  // ── Анги ──

  @Get('courses')
  @ApiOperation({ summary: 'Ангиуд — нэр/төлвөөр шүүнэ' })
  listCourses(@Query() q: ListYogaCoursesDto) {
    return this.yoga.listCourses(q);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Йогийн товч тоо — заалнаас тусдаа' })
  summary() {
    return this.yoga.summary();
  }

  @Get('courses/:id')
  @ApiOperation({ summary: 'Нэг анги' })
  getCourse(@Param('id', ParseUUIDPipe) id: string) {
    return this.yoga.getCourse(id);
  }

  @Roles(Role.MANAGER)
  @Post('courses')
  @ApiOperation({
    summary: 'Анги үүсгэх',
    description:
      'Хугацаа + долоо хоногийн гарагуудаас оролтын өдрүүд ТООЦООЛОГДОНО.',
  })
  createCourse(@Body() dto: CreateYogaCourseDto) {
    return this.yoga.createCourse(dto);
  }

  @Roles(Role.MANAGER)
  @Patch('courses/:id')
  @ApiOperation({ summary: 'Анги засах / архивлах' })
  updateCourse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateYogaCourseDto,
  ) {
    return this.yoga.updateCourse(id, dto);
  }

  /** ⚠ Гишүүнтэй ангийг устгахгүй — 409. Оронд нь архивлана. */
  @Roles(Role.MANAGER)
  @Delete('courses/:id')
  @ApiOperation({ summary: 'Хоосон анги устгах' })
  deleteCourse(@Param('id', ParseUUIDPipe) id: string) {
    return this.yoga.deleteCourse(id);
  }

  // ── Цагийн хуваарь ──

  @Get('courses/:id/schedule')
  @ApiOperation({
    summary: 'Ангийн бүх оролт — ирцийн тоотой',
    description: 'Огноонууд нь хадгалагддаггүй, хуваарь дээрээс тооцоологдоно.',
  })
  schedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.yoga.schedule(id);
  }

  @Get('courses/:id/sessions/:on')
  @ApiOperation({ summary: 'Нэг оролтын дэлгэрэнгүй — хэн ирсэн, хэн үгүй' })
  sessionDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('on') on: string,
  ) {
    return this.yoga.sessionDetail(id, on);
  }

  // ── Гишүүд ──

  @Get('courses/:id/enrollments')
  @ApiOperation({ summary: 'Ангийн гишүүд — төлбөр, ирцийн тоотой' })
  listEnrollments(@Param('id', ParseUUIDPipe) id: string) {
    return this.yoga.listEnrollments(id);
  }

  @Post('courses/:id/enrollments')
  @ApiOperation({
    summary: 'Гишүүн бүртгэх',
    description:
      '`memberId` өгвөл нэрийг гишүүний бүртгэлээс авна. Өгөхгүй бол ' +
      '`name` ЗААВАЛ. `amountPaid` нь `amountDue`-ээс бага бол ҮЛДЭГДЭЛ үүснэ.',
  })
  addEnrollment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateYogaEnrollmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.yoga.addEnrollment(id, dto, user.id);
  }

  @Patch('enrollments/:id')
  @ApiOperation({ summary: 'Гишүүний мэдээлэл засах' })
  updateEnrollment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateYogaEnrollmentDto,
  ) {
    return this.yoga.updateEnrollment(id, dto);
  }

  /** ⚠ Орлуулахгүй НЭМНЭ — йогийн төлбөр хэсэгчилж ордог. */
  @Post('enrollments/:id/payments')
  @ApiOperation({ summary: 'Нэмэлт төлбөр хүлээн авах' })
  addPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.yoga.addPayment(id, dto, user.id);
  }

  @Delete('enrollments/:id')
  @ApiOperation({ summary: 'Гишүүнийг ангиас хасах' })
  removeEnrollment(@Param('id', ParseUUIDPipe) id: string) {
    return this.yoga.removeEnrollment(id);
  }

  // ── Ирц ──

  /**
   * ⚠ Ирц бүртгэхэд ХААЛГА НЭЭГДЭНЭ (`openDoor: false` гэвэл үгүй).
   * Терминал унасан ч ирц бүртгэгдэнэ — хариунд `door.opened` ирнэ.
   */
  @Post('courses/:id/attendance')
  @ApiOperation({ summary: 'Ирц бүртгэж, хаалга нээх' })
  markAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkAttendanceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.yoga.markAttendance(id, dto, user.id);
  }

  @Delete('courses/:id/attendance/:enrollmentId/:on')
  @ApiOperation({ summary: 'Ирцийг буцаах — андуурч дарсан үед' })
  unmarkAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Param('on') on: string,
  ) {
    return this.yoga.unmarkAttendance(id, enrollmentId, on);
  }
}
