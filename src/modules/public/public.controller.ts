import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { LookupDto, PublicInvoiceDto } from './dto/public.dto';
import { PublicService } from './public.service';

/**
 * Нэвтрэлтгүй `/pay` хуудасны API.
 *
 * Throttle нь энд ЧУХАЛ: утасны дугаараар хэн ч хайж болно. Хязгааргүй бол
 * дугаар брутфорслож «энэ хүн гишүүн мөн үү» гэдгийг тандах боломжтой болно
 * (docs/01-integration-model.md §6.6).
 */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Get('packages')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Идэвхтэй багцууд' })
  packages() {
    return this.svc.listPackages();
  }

  @Post('lookup')
  // Дугаар тандахаас сэргийлж чанга хязгаар.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: '1-р түвшин — утсаар шалгах',
    description:
      'ЗӨВХӨН далдалсан нэр буцаана. Огноо, ирц, түүх харагдахгүй. ' +
      'Олдоогүй ч 200 `{found:false}`.',
  })
  lookup(@Body() dto: LookupDto) {
    return this.svc.lookup(dto.phone);
  }

  @Get('members/:token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: '2-р түвшин — картын токеноор бүрэн мэдээлэл' })
  byToken(@Param('token') token: string) {
    return this.svc.byToken(token);
  }

  @Post('invoices')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({
    summary: 'Нэхэмжлэх үүсгэх',
    description: 'Дүнг сервер тооцно. Хүлээгдэж буй байвал байгааг буцаана.',
  })
  createInvoice(@Body() dto: PublicInvoiceDto) {
    return this.svc.createInvoice(dto);
  }

  @Get('invoices/:id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Төлбөрийн төлөв (polling)' })
  invoiceStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.invoiceStatus(id);
  }
}
