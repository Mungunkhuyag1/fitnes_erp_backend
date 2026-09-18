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
    // Багцын жагсаалтыг ХАМТ буцаана — дэлгэц дээр «аль багцад» гэдгийг
    // сонгуулах тул тусдаа дуудлага хийлгэх нь утгагүй.
    const [stats, pickable] = await Promise.all([
      this.svc.statsMany(rows.map((p) => p.id)),
      this.svc.pickablePackages(),
    ]);
    return {
      kinds: Object.entries(PROMOTION_KIND_LABEL).map(([value, label]) => ({
        value,
        label,
      })),
      packages: pickable.map((p) => ({
        id: p.id,
        name: p.name,
        days: p.days,
        price: Number(p.price),
      })),
      promotions: rows.map((p) => ({
        ...p,
        value: Number(p.value),
        stats: stats.get(p.id),
      })),
    };
  }

  /**
   * Одоо үйлчилж буй урамшууллууд — ОЛОН байж болно.
   *
   * Эрэмбэ нь давхарлах дарааллыг заана: дээд хязгаарт мөргөхөд
   * эхнийх нь бүтнээрээ, сүүлийнх нь дутуу хэрэглэгдэнэ.
   */
  @Get('active')
  @ApiOperation({ summary: 'Одоо үйлчилж буй урамшууллууд' })
  async active() {
    const rows = await this.svc.activeNow();
    return rows.map((p) => ({ ...p, value: Number(p.value) }));
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
   * Идэвхжүүлэх.
   *
   * ⚠ Бусдыг УНТРААХГҮЙ: олон урамшуулал зэрэг явж, тохирсон нь бүгд
   * давхарлана. Онцгой хямдрал хийх бол `exclusive` тугийг хэрэглэнэ.
   */
  @Roles(Role.ADMIN)
  @Post(':id/activate')
  @ApiOperation({ summary: 'Идэвхжүүлэх' })
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
