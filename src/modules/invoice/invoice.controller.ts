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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { BonumService } from './bonum.service';
import { CreateInvoiceDto, ListInvoicesDto } from './dto/invoice.dto';
import { InvoiceService } from './invoice.service';

@ApiTags('invoices')
@ApiBearerAuth('access-token')
@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly bonum: BonumService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Нэхэмжлэхүүд (хуудаслалттай)' })
  list(@Query() q: ListInvoicesDto) {
    return this.invoices.list(q);
  }

  /**
   * Анхдагчаар кэшлэгдсэн токеныг шалгана — Bonum-ын хязгаартай auth-ыг
   * зарцуулахгүй. `?force=true` бол ЖИНХЭНЭ шинэ auth хийнэ; зөвхөн
   * ажилтан «холболт шалгах» товчийг дарсан үед хэрэглэнэ.
   */
  @Get('bonum/ping')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Bonum холболтыг шалгах' })
  @ApiQuery({ name: 'force', required: false, description: 'Шинэ токен албадан авах' })
  ping(@Query('force') force?: string) {
    return this.bonum.ping(force === 'true');
  }

  /**
   * Баталгаажуулалт хүлээж буй төлбөрүүд.
   *
   * Хөнгөлөлттэй багц онлайнаар төлөгдсөн ч эрх нь нээгдээгүй байна —
   * хэрэглэгч ресепшн дээр үнэмлэхээ үзүүлэх ёстой. Энэ жагсаалт нь
   * ажилтанд «хэн ирэх ёстой вэ» гэдгийг хэлнэ.
   */
  @Get('awaiting-approval')
  @ApiOperation({ summary: 'Баримт шалгуулахаар хүлээж буй төлбөр' })
  awaiting() {
    return this.invoices.awaitingApproval();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Нэхэмжлэхийн мэдээлэл' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Нэхэмжлэх үүсгэх (ажилтан гишүүний өмнөөс)',
    description:
      'Хүлээгдэж буй нэхэмжлэх байвал ШИНЭ үүсгэхгүй, байгааг буцаана.',
  })
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.invoices.create(dto, user.id);
  }

  @Roles(Role.MANAGER)
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Цуцлах (зөвхөн хүлээгдэж буйг)' })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.cancel(id);
  }

  @Roles(Role.ADMIN)
  @Post(':id/mark-paid')
  @ApiOperation({
    summary: 'Гараар төлөгдсөн болгох',
    description:
      'Webhook ирээгүй ч мөнгө орсон нь батлагдсан тохиолдолд. Аудитад бичигдэнэ.',
  })
  async markPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const inv = await this.invoices.get(id);
    return this.invoices.markPaid(
      { transactionId: inv.transactionId },
      null,
      { staffUserId: user.id, ip: req.ip },
    );
  }
  /** Баримт шалгаж эрхийг нээх. */
  @Roles(Role.RECEPTION)
  @Post(':id/approve')
  @ApiOperation({ summary: 'Баримт шалгаж эрхийг нээх' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoices.approve(id, user.id, body.note);
  }

}
