import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { BonumService } from './bonum.service';
import { InvoiceService } from './invoice.service';

type Loose = Record<string, unknown>;

/** Талбарын нэр Bonum-ийн хувилбараас хамаарч зөрдөг тул хувилбаруудыг хайна. */
function pick(obj: Loose | undefined, ...keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

const PAID = ['SUCCESS', 'PAID', 'APPROVED', 'PAYMENT_SUCCESS', 'COMPLETED'];
const FAILED = ['FAILED', 'FAIL', 'DECLINED', 'CANCELLED', 'CANCELED', 'EXPIRED'];

/**
 * Bonum-ийн төлбөрийн webhook.
 *
 * Дүрмүүд (docs/01-integration-model.md §6.3):
 *  • Гарын үсгийг ТҮҮХИЙ бие дээр шалгана
 *  • Давхардлыг зөвшөөрнө — идемпотент (`markPaid` дахин ажиллахгүй)
 *  • Мөнгө орсныг бүртгэсний дараа шууд `200` — терминал/Loopy руу хүргэх нь
 *    outbox-ийн ажил. PSP-г хүлээлгэхгүй, дахин илгээхэд хүргэхгүй
 *  • Танихгүй payload дээр ч `200` — Bonum төгсгөлгүй дахин илгээхээс сэргийлнэ
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/bonum')
export class BonumWebhookController {
  private readonly log = new Logger(BonumWebhookController.name);

  constructor(
    private readonly bonum: BonumService,
    private readonly invoices: InvoiceService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bonum payment webhook' })
  async handle(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody?.toString('utf8') ?? '';
    // Эхний үед бодит payload-ыг бүтнээр логлоно — талбарын нэрийг тааруулахад.
    this.log.log(`Bonum webhook: ${raw.slice(0, 2000)}`);

    const header = (name: string): string | undefined => {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };

    // ── Гарын үсэг ──
    const secret =
      header('x-webhook-secret') ??
      header('bonum_webhook_secret') ??
      header('bonum-webhook-secret');
    if (!this.bonum.verifyWebhookSecret(secret)) {
      this.log.warn('Bonum webhook: secret буруу/дутуу');
      throw new UnauthorizedException('webhook secret буруу');
    }


    //TODO: daraa n production butsaana
    // const checksum = header('x-checksum-v2');
    // const checksumKey = this.config.get<string>('bonum.checksumKey');
    // if (checksumKey && checksum) {
    //   if (!this.bonum.verifyChecksum(raw, checksum)) {
    //     this.log.warn('Bonum webhook: checksum таарсангүй');
    //     throw new BadRequestException('checksum буруу');
    //   }
    // } else if (checksumKey) {
    //   // Түлхүүр тохируулсан ч header ирээгүй — Bonum portal-д checksum
    //   // унтраалттай байж болно. Логлож үргэлжлүүлнэ (secret нь шалгагдсан).
    //   this.log.warn('Bonum webhook: x-checksum-v2 header ирсэнгүй');
    // }

    let payload: Loose;
    try {
      payload = JSON.parse(raw) as Loose;
    } catch {
      throw new BadRequestException('JSON буруу');
    }

    const body = (payload.body as Loose) ?? {};
    const txn =
      pick(body, 'transactionId', 'transaction_id') ??
      pick(payload, 'transactionId', 'transaction_id');
    const invoiceId =
      pick(body, 'invoiceId', 'invoice_id') ??
      pick(payload, 'invoiceId', 'invoice_id');
    const status = (
      pick(payload, 'status') ??
      pick(body, 'status') ??
      ''
    ).toUpperCase();

    this.log.log(
      `Bonum webhook задлав: txn=${txn ?? '-'} invoice=${invoiceId ?? '-'} status=${status || '-'}`,
    );

    if (!txn && !invoiceId) {
      // Дахин илгээхэд утга байхгүй — 200 буцаана (лог-д үлдсэн).
      this.log.warn('Bonum webhook: transactionId/invoiceId олдсонгүй');
      return { ok: true };
    }
    const ref = { transactionId: txn, providerInvoiceId: invoiceId };

    if (PAID.includes(status)) {
      const res = await this.invoices.markPaid(ref, payload);
      return { ok: true, already: res.already ?? false };
    }
    if (FAILED.includes(status)) {
      await this.invoices.markFailed(ref, payload);
      return { ok: true };
    }

    // Танихгүй төлөв — Bonum шинэ утга нэмсэн байж болно. Логлоод 200.
    this.log.warn(`Bonum webhook: танихгүй төлөв «${status}»`);
    return { ok: true };
  }
}
