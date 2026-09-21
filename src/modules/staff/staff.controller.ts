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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PageQueryDto } from '../../common/dto/pagination.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CreateStaffDto,
  ResetStaffPasswordDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { StaffService } from './staff.service';

@ApiTags('staff')
@ApiBearerAuth('access-token')
@Roles(Role.ADMIN)
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /**
   * Ажилтнуудын ТОВЧ жагсаалт — сонгох хяналтад.
   *
   * ★ ЯАГААД `GET /staff`-ЫГ АШИГЛААГҮЙ ВЭ
   *
   * Тэр нь хэрэглэгчийн БҮРЭН бүртгэлийг буцаадаг тул контроллерын
   * түвшинд ADMIN гэж хаасан. Гэвч «хэн хийх вэ» гэж сонгоход
   * зөвхөн НЭР хэрэгтэй бөгөөд төлөвлөгөөг MANAGER ч хийнэ.
   * Ийм тул имэйл, сүүлийн нэвтрэлт зэрэггүй тусдаа зам.
   */
  @Roles(Role.MANAGER)
  @Get('brief')
  @ApiOperation({ summary: 'Ажилтнууд — зөвхөн ID/нэр/үүрэг' })
  brief() {
    return this.staff.brief();
  }

  @Get()
  @ApiOperation({ summary: 'Ажилтны жагсаалт (хуудаслалттай)' })
  list(@Query() q: PageQueryDto) {
    return this.staff.list(q);
  }

  @Post()
  @ApiOperation({ summary: 'Ажилтан үүсгэх (түр нууц үгтэй)' })
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Нэр, дүр, идэвхтэй эсэхийг засах' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staff.update(id, dto);
  }

  @Get('password-resets')
  @ApiOperation({ summary: 'Шийдэгдээгүй нууц үг сэргээх хүсэлтүүд' })
  listResets() {
    return this.staff.listResets();
  }

  @Post('password-resets/:id/resolve')
  @ApiOperation({
    summary: 'Хүсэлтийг хаах',
    description: 'Өөр аргаар шийдсэн эсвэл хуурамч хүсэлт байсан үед.',
  })
  resolveReset(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') staffId: string,
  ) {
    return this.staff.resolveReset(id, staffId);
  }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'Түр нууц үг тавих' })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetStaffPasswordDto,
  ) {
    return this.staff.resetPassword(id, dto.password);
  }
}
