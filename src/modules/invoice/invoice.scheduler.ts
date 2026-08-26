import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InvoiceService } from './invoice.service';

/**
 * Хугацаа дууссан нэхэмжлэхийг хаах.
 *
 * ЯАГААД BullMQ-ИЙН DELAYED JOB БИШ ВЭ:
 *
 *   • BullMQ нь Redis шаарддаг — энэ систем Redis ашигладаггүй
 *   • Delayed job нь систем унтарсан үед АЛДАГДАЖ болно; тэгвэл нэхэмжлэх
 *     үүрд `pending` хэвээр үлдэнэ
 *   • Шүүлт нь `(status, expires_at)` индексээр ажилладаг — 30 секунд
 *     тутам ажиллуулахад ч өртөг үл мэдэгдэхүйц
 *
 * Давтамж нь TTL-ээс ЗААВАЛ богино байх ёстой: 5 минутын TTL-д 5 минут
 * тутам шүүвэл нэхэмжлэх 10 минут хүртэл нээлттэй үлдэж болно.
 */
@Injectable()
export class InvoiceScheduler {
  constructor(private readonly invoices: InvoiceService) {}

  @Interval(
    'expire-invoices',
    Number(process.env.INVOICE_EXPIRE_INTERVAL_MS ?? 30_000),
  )
  async tick(): Promise<void> {
    await this.invoices.expireStale();
  }
}
