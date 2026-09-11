import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CreateGiftDto, UseGiftDto } from './dto/gift.dto';
import { GIFT_STATUS_LABEL } from './gift.entity';
import { GiftService } from './gift.service';

@ApiTags('gift')
@ApiBearerAuth('access-token')
@Controller('gift-cards')
export class GiftController {
  constructor(private readonly svc: GiftService) {}

  @Get()
  @ApiOperation({ summary: 'Бэлгийн картууд' })
  async list() {
    const data = await this.svc.list();
    return {
      ...data,
      statuses: Object.entries(GIFT_STATUS_LABEL).map(([value, label]) => ({
        value,
        label,
      })),
    };
  }

  @Roles(Role.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Бэлгийн карт үүсгэх' })
  create(@Body() dto: CreateGiftDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user);
  }

  /**
   * Loopy-гоос enroll хийсэн картуудыг татаж утсаар тааруулна.
   *
   * Хүлээн авагч хэзээ enroll хийхийг WinFit мэдэхгүй — Loopy тал энэ
   * эвентийг илгээдэггүй тул ажилтан товч дарж шинэчилнэ.
   */
  @Roles(Role.MANAGER)
  @Post('sync')
  @ApiOperation({ summary: 'Wallet-д авсан картуудыг холбох' })
  sync() {
    return this.svc.sync();
  }

  /** Эрхийг ГАРААР сунгасны дараа тэмдэглэнэ. */
  @Roles(Role.RECEPTION)
  @Post(':id/use')
  @ApiOperation({ summary: 'Ашигласан гэж тэмдэглэх' })
  use(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UseGiftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.markUsed(id, dto, user);
  }

  @Roles(Role.MANAGER)
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Цуцлах' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.svc.cancel(id, user);
  }
}
