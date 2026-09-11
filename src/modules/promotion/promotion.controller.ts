import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CreatePromotionDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';
import { PROMOTION_KIND_LABEL } from './promotion.entity';
import { PromotionService } from './promotion.service';

@ApiTags('promotions')
@ApiBearerAuth('access-token')
@Controller('promotions')
export class PromotionController {
  constructor(private readonly svc: PromotionService) {}

  @Get()
  @ApiOperation({ summary: 'Урамшууллууд' })
  async list() {
    const rows = await this.svc.list();
    return {
      kinds: Object.entries(PROMOTION_KIND_LABEL).map(([value, label]) => ({
        value,
        label,
      })),
      promotions: await Promise.all(
        rows.map(async (p) => ({
          ...p,
          value: Number(p.value),
          stats: await this.svc.stats(p.id),
        })),
      ),
    };
  }

  /** Одоо үйлчилж буй — дэлгэц ба ресепшнд. */
  @Get('current')
  @ApiOperation({ summary: 'Одоо үйлчилж буй урамшуулал' })
  async current() {
    const p = await this.svc.current();
    return p ? { ...p, value: Number(p.value) } : null;
  }

  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Урамшуулал үүсгэх (идэвхгүй байдлаар)' })
  create(@Body() dto: CreatePromotionDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user.id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Урамшуулал засах' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return this.svc.update(id, dto);
  }

  /**
   * Идэвхжүүлэх — бусдыг нь АВТОМАТААР унтраана.
   *
   * Нэг үед нэг л урамшуулал идэвхтэй байх дүрэм DB дээр барьцтай тул
   * энд зориудаар бусдыг унтраахгүй бол алдаа шидэх байлаа.
   */
  @Roles(Role.ADMIN)
  @Post(':id/activate')
  @ApiOperation({ summary: 'Идэвхжүүлэх (бусдыг унтраана)' })
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.activate(id);
  }

  @Roles(Role.ADMIN)
  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Унтраах' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deactivate(id);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Устгах (ашиглаагүй бол)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}
