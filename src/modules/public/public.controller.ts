import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { LookupDto, PublicInvoiceDto } from './dto/public.dto';
import { InvoiceService } from '../invoice/invoice.service';
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
  constructor(
    private readonly svc: PublicService,
    private readonly config: ConfigService,
    private readonly invoices: InvoiceService,
  ) {}

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
  /**
   * ДУУРАЙЛГАН банкны хуудас — зөвхөн `BONUM_MODE=stub` үед.
   *
   * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
   *
   * Stub горимд жинхэнэ банк байхгүй тул «Төлөх» дарсны дараа хаашаа ч
   * очих газаргүй. Буцах хаяг руу шууд заавал төлбөр хийгдээгүй атал
   * буцах хуудас нээгдэж, «банкнаас хариу хүлээж байна» гэж мөнхөд
   * эргэлдэнэ. Энэ хуудас нь банкны сонголтыг (төлөх / цуцлах)
   * дуурайлгаж, жинхэнэ урсгалтай ижил замаар буцаана.
   *
   * ⚠ Production-д `BONUM_MODE=stub` нь ачаалахыг ЗОГСООДОГ тул энэ
   * хуудас тэнд хэзээ ч гарч ирэхгүй. Дээр нь давхар шалгалт тавьсан.
   */
  @Public()
  @Get('stub-bank/:transactionId')
  @ApiExcludeEndpoint()
  async stubBank(
    @Param('transactionId') transactionId: string,
    @Query('cb') cb: string | undefined,
    @Query('action') action: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (
      this.config.get<string>('gateways.bonum') !== 'stub' ||
      process.env.NODE_ENV === 'production'
    ) {
      throw new NotFoundException();
    }

    const back = cb && /^https?:\/\//.test(cb) ? cb : '/pay';

    if (action === 'pay') {
      await this.invoices.markPaid({ transactionId }, { stubBank: true });
      res.redirect(back);
      return;
    }
    if (action === 'cancel') {
      res.redirect(back);
      return;
    }

    const self = (a: string): string =>
      `/api/public/stub-bank/${encodeURIComponent(transactionId)}` +
      `?cb=${encodeURIComponent(cb ?? '')}&action=${a}`;

    res.type('html').send(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Дуурайлган банк</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f4;
       display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
  .c{background:#fff;border-radius:14px;padding:28px;max-width:360px;width:100%;text-align:center}
  h1{font-size:18px;margin:0 0 6px;color:#15180f}
  p{color:#5a6050;font-size:14px;margin:0 0 20px;line-height:1.5}
  a{display:block;padding:13px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px}
  .pay{background:#15180f;color:#fff;margin-bottom:9px}
  .no{background:#eef0e7;color:#5a6050}
  .tag{display:inline-block;background:#fdf3d8;color:#7a5a06;font-size:11px;font-weight:600;
       letter-spacing:.08em;text-transform:uppercase;padding:4px 9px;border-radius:5px;margin-bottom:14px}
</style>
<div class="c">
  <span class="tag">Дуурайлган банк</span>
  <h1>Төлбөрийг баталгаажуулах уу?</h1>
  <p>Жинхэнэ банк холбогдоогүй байна (<code>BONUM_MODE=stub</code>).
     Энэ хуудас банкны сонголтыг дуурайлгаж байна.</p>
  <a class="pay" href="${self('pay')}">Төлөх</a>
  <a class="no" href="${self('cancel')}">Цуцлах</a>
</div>`);
  }

}
