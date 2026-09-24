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
  CreateYogaBookingDto,
  CreateYogaClassDto,
  ListYogaClassesDto,
  UpdateYogaBookingDto,
  UpdateYogaClassDto,
} from './dto/yoga.dto';
import { YogaService } from './yoga.service';

/**
 * Йогийн хичээл ба оролцогчид.
 *
 * ⚠ Терминал, гишүүнчлэл, outbox аль нэгд нь ХҮРДЭГГҮЙ. Хаалгыг админ
 * өөрөө нээж өгдөг тул энэ нь цэвэр БҮРТГЭЛ.
 *
 * Эрх: ресепшн ч бүртгэнэ — йогийн оролцогчийг хичээл эхлэхийн өмнө
 * нэмэх нь ердийн ажил. Хичээлийн ХУВААРЬ өөрчлөхөд менежер.
 */
@ApiTags('yoga')
@ApiBearerAuth('access-token')
@Controller('yoga')
export class YogaController {
  constructor(private readonly yoga: YogaService) {}

  // ── Хичээл ──

  @Get('classes')
  @ApiOperation({ summary: 'Хичээлийн хуваарь (анхдагчаар 30 хоног)' })
  listClasses(@Query() q: ListYogaClassesDto) {
    return this.yoga.listClasses(q);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Йогийн товч тоо — тусдаа тооцоо' })
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.yoga.summary(from, to);
  }

  @Get('classes/:id')
  @ApiOperation({ summary: 'Нэг хичээл' })
  getClass(@Param('id', ParseUUIDPipe) id: string) {
    return this.yoga.getClass(id);
  }

  @Roles(Role.MANAGER)
  @Post('classes')
  @ApiOperation({
    summary: 'Хичээл үүсгэх',
    description: '`repeatWeeks > 1` бол 7 хоног тутам давтаж олон мөр үүсгэнэ.',
  })
  createClass(@Body() dto: CreateYogaClassDto) {
    return this.yoga.createClass(dto);
  }

  @Roles(Role.MANAGER)
  @Patch('classes/:id')
  @ApiOperation({ summary: 'Хичээл засах / цуцлах' })
  updateClass(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateYogaClassDto,
  ) {
    return this.yoga.updateClass(id, dto);
  }

  /**
   * ⚠ Оролцогчтой хичээлийг устгахгүй — 409 буцаана. Оронд нь цуцална
   * (`PATCH { cancelled: true }`), тэгвэл төлбөрийн бүртгэл үлдэнэ.
   */
  @Roles(Role.MANAGER)
  @Delete('classes/:id')
  @ApiOperation({ summary: 'Хоосон хичээл устгах' })
  deleteClass(@Param('id', ParseUUIDPipe) id: string) {
    return this.yoga.deleteClass(id);
  }

  // ── Оролцогч ──

  @Get('classes/:id/bookings')
  @ApiOperation({ summary: 'Хичээлийн оролцогчид' })
  listBookings(@Param('id', ParseUUIDPipe) id: string) {
    return this.yoga.listBookings(id);
  }

  @Post('classes/:id/bookings')
  @ApiOperation({
    summary: 'Оролцогч нэмэх',
    description:
      '`memberId` өгвөл нэрийг гишүүний бүртгэлээс авна. Өгөхгүй бол ' +
      '`name` ЗААВАЛ — йогт гишүүн биш хүн ирж болно.',
  })
  addBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateYogaBookingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.yoga.addBooking(id, dto, user.id);
  }

  @Patch('bookings/:id')
  @ApiOperation({ summary: 'Оролцогч засах — төлбөр, ирц' })
  updateBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateYogaBookingDto,
  ) {
    return this.yoga.updateBooking(id, dto);
  }

  @Delete('bookings/:id')
  @ApiOperation({ summary: 'Оролцогчийг хасах' })
  removeBooking(@Param('id', ParseUUIDPipe) id: string) {
    return this.yoga.removeBooking(id);
  }
}
