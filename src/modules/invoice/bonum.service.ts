import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';
import { IntegrationToken } from './integration-token.entity';

interface CreateInvoiceInput {
  amount: number;
  transactionId: string;
  /** Төлсний дараа гишүүнийг буцаах хуудас (Bonum-д ЗААВАЛ). */
  callback: string;
  description?: string;
}

export interface CreateInvoiceResult {
  invoiceId: string;
  followUpLink: string;
}

/**
 * Bonum web payment (PSP) интеграци — ЖИНХЭНЭ дуудлага.
 *
 *   auth    : GET  /bonum-gateway/ecommerce/auth/create
 *             (Authorization: AppSecret …, X-TERMINAL-ID: …)  → { accessToken, expiresIn }
 *   invoice : POST /bonum-gateway/ecommerce/invoices
 *             (Authorization: Bearer …)                       → { invoiceId, followUpLink }
 *   webhook : x-checksum-v2 = HMAC-SHA256(rawBody, CHECKSUM_KEY) hex
 *
 * ⚠ Bonum-ын auth нь ХЯЗГААРТАЙ (throttle). Тиймээс токеныг гурван давхар
 * хамгаалалттай барина:
 *
 *   1. Санах ойн кэш   — ердийн хүсэлт DB хүртэл ч очихгүй.
 *   2. `integration_tokens` хүснэгт — restart/redeploy-д амьд үлдэнэ.
 *   3. `SELECT … FOR UPDATE` — зэрэг ирсэн хүсэлтүүдээс ЗӨВХӨН НЭГ нь auth
 *      хийнэ, үлдсэн нь тэр токеныг хүлээж авна («сүргийн дайралт» үгүй).
 *
 * Мөн амжилтгүй болбол `retry_after` тавьж түр завсарлана — унасан Bonum
 * руу секунд тутам цохихгүй.
 *
 * Bonum-ын auth нь refresh token БУЦААДАГГҮЙ — зөвхөн `accessToken` +
 * `expiresIn`. Тиймээс сэргээх цорын ганц зам нь дахин `auth/create`.
 */
/** Entity талбар → DB багана (`orUpdate` нь баганын нэр шаарддаг). */
const COLUMN: Record<string, string> = {
  accessToken: 'access_token',
  expiresAt: 'expires_at',
  retryAfter: 'retry_after',
  lastError: 'last_error',
};

@Injectable()
export class BonumService {
  private static readonly PROVIDER = 'bonum';
  /** Auth амжилтгүй болоход хэдэн секунд завсарлах. 429 бол уртаар. */
  private static readonly BACKOFF_SEC = 20;
  private static readonly BACKOFF_THROTTLED_SEC = 120;

  private readonly log = new Logger(BonumService.name);
  private token: { value: string; expiresAt: number } | null = null;
  /** Нэг процесс дотор давхар auth явуулахгүй (single-flight). */
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  isConfigured(): boolean {
    return !!(
      this.config.get<string>('bonum.appSecret') &&
      this.config.get<string>('bonum.terminalId')
    );
  }

  private base(): string {
    return (
      this.config.get<string>('bonum.apiUrl') ?? 'https://testapi.bonum.mn'
    ).replace(/\/$/, '');
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Bonum креденшл тохируулаагүй (BONUM_APP_SECRET / BONUM_TERMINAL_ID)',
      );
    }
  }

  // ── Токен ──

  private async getToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }
    this.assertConfigured();

    // Зэрэг ирсэн хүсэлтүүд НЭГ л auth-ыг хүлээнэ.
    if (this.inflight) return this.inflight;
    this.inflight = this.resolveToken(force).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /**
   * DB-ийн мөрийг түгжиж авснаар ОЛОН процесс (Railway replica) байсан ч
   * зөвхөн нэг нь Bonum руу очно.
   */
  private async resolveToken(force: boolean): Promise<string> {
    /**
     * ⚠ Auth амжилтгүй болбол түүнийг ГҮЙЛГЭЭ ДОТОР бичиж БОЛОХГҮЙ —
     * дараа нь алдаа шидэхэд гүйлгээ буцаж, backoff устана. Тиймээс
     * алдааг энд тэмдэглээд гүйлгээ хаагдсаны ДАРАА бичнэ.
     */
    let failure: { retryAfter: Date; lastError: string } | undefined;

    const token = await this.ds.transaction(async (m) => {
      const repo = m.getRepository(IntegrationToken);
      const now = new Date();

      // Түгжээ авах — нөгөө процесс auth хийж байвал энд хүлээнэ.
      const row = await repo.findOne({
        where: { provider: BonumService.PROVIDER },
        lock: { mode: 'pessimistic_write' },
      });

      // Хүлээж байх зуур нөгөө процесс шинэ токен бичсэн бол түүнийг авна.
      if (!force && row && row.expiresAt > now) {
        this.token = {
          value: row.accessToken,
          expiresAt: row.expiresAt.getTime(),
        };
        return row.accessToken;
      }

      // Саяхан унасан бол Bonum руу дахин очихгүй — шууд буцаана.
      if (row?.retryAfter && row.retryAfter > now) {
        const sec = Math.ceil((row.retryAfter.getTime() - now.getTime()) / 1000);
        throw new ServiceUnavailableException(
          `Bonum түр хүртээмжгүй байна — ${sec}с дараа дахин оролдоно уу` +
            (row.lastError ? ` (${row.lastError})` : ''),
        );
      }

      let data: { accessToken: string; expiresIn?: number };
      try {
        data = await this.authenticate();
      } catch (e) {
        const err = e as Error & { status?: number };
        failure = {
          retryAfter: new Date(
            now.getTime() +
              (err.status === 429
                ? BonumService.BACKOFF_THROTTLED_SEC
                : BonumService.BACKOFF_SEC) *
                1000,
          ),
          lastError: err.message.slice(0, 300),
        };
        return null;
      }

      // 60 секундын нөөц хугацаа хасна — хүсэлт явж байх зуур хүчингүй болохоос сэргийлнэ.
      const ttlSec = Math.max(60, (data.expiresIn ?? 1800) - 60);
      const expiresAt = new Date(now.getTime() + ttlSec * 1000);
      await this.remember(repo, {
        accessToken: data.accessToken,
        expiresAt,
        retryAfter: null,
        lastError: null,
      });
      this.token = { value: data.accessToken, expiresAt: expiresAt.getTime() };
      this.log.log(`Bonum токен авав (${ttlSec}с хүчинтэй)`);
      return data.accessToken;
    });

    if (token !== null) return token;

    const f = failure as { retryAfter: Date; lastError: string };
    await this.remember(this.ds.getRepository(IntegrationToken), f);
    this.log.warn(
      `Bonum auth унав — ${Math.ceil(
        (f.retryAfter.getTime() - Date.now()) / 1000,
      )}с завсарлана: ${f.lastError}`,
    );
    throw new ServiceUnavailableException(f.lastError);
  }

  /** Токены мөрийг үүсгэх эсвэл шинэчлэх. */
  private async remember(
    repo: import('typeorm').Repository<IntegrationToken>,
    patch: Partial<IntegrationToken>,
  ): Promise<void> {
    await repo
      .createQueryBuilder()
      .insert()
      .into(IntegrationToken)
      .values({
        provider: BonumService.PROVIDER,
        accessToken: patch.accessToken ?? '',
        // Алдаа бичих үед хуучин токеныг хүчингүй болгохгүй — доорх
        // `orUpdate` зөвхөн дамжуулсан баганыг л шинэчилнэ.
        expiresAt: patch.expiresAt ?? new Date(0),
        retryAfter: patch.retryAfter ?? null,
        lastError: patch.lastError ?? null,
      })
      // Зөвхөн ДАМЖУУЛСАН баганыг шинэчилнэ: алдаа бичихэд хүчинтэй
      // токен арилахгүй, токен бичихэд `retry_after` цэвэрлэгдэнэ.
      .orUpdate(
        Object.keys(patch).map((k) => COLUMN[k] ?? k),
        ['provider'],
      )
      .execute();
  }

  /** Bonum руу бодит auth дуудлага. */
  private async authenticate(): Promise<{
    accessToken: string;
    expiresIn?: number;
  }> {
    let res: Response;
    try {
      res = await fetch(`${this.base()}/bonum-gateway/ecommerce/auth/create`, {
        method: 'GET',
        headers: {
          Authorization: `AppSecret ${this.config.getOrThrow<string>('bonum.appSecret')}`,
          'X-TERMINAL-ID': this.config.getOrThrow<string>('bonum.terminalId'),
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      // Сүлжээ тасарсан / timeout — Bonum огт хариу өгөөгүй.
      throw new Error(`Bonum-тай холбогдож чадсангүй (${(e as Error).name})`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.log.error(`Bonum auth амжилтгүй: ${res.status} ${body.slice(0, 300)}`);
      const err = Object.assign(
        new Error(
          res.status === 429
            ? 'Bonum хүсэлтийн хязгаарт хүрсэн (auth 429)'
            : `Bonum-тай холбогдож чадсангүй (auth ${res.status})`,
        ),
        { status: res.status },
      );
      throw err;
    }
    return (await res.json()) as { accessToken: string; expiresIn?: number };
  }

  // ── Нэхэмжлэх ──

  async createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
    this.assertConfigured();
    const title = input.description ?? 'Гишүүнчлэл';
    const body = JSON.stringify({
      amount: input.amount,
      callback: input.callback,
      transactionId: input.transactionId,
      expiresIn: this.config.get<number>('bonum.invoiceTtlSec') ?? 3600,
      items: [
        { title, remark: title, amount: input.amount, count: 1 },
      ],
    });

    // Токен хүчингүй (401) бол НЭГ удаа сэргээж дахин илгээнэ.
    let res = await this.post(await this.getToken(), body);
    if (res.status === 401) {
      this.log.warn('Bonum invoice 401 — токен сэргээж дахин илгээж байна');
      res = await this.post(await this.getToken(true), body);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      this.log.error(
        `Bonum invoice амжилтгүй: ${res.status} ${errBody.slice(0, 400)}`,
      );
      throw new ServiceUnavailableException(
        `Bonum нэхэмжлэх үүсгэж чадсангүй (${res.status})`,
      );
    }

    const data = (await res.json()) as {
      invoiceId: string;
      followUpLink: string;
    };
    this.log.log(
      `Bonum нэхэмжлэх OK: txn=${input.transactionId} invoiceId=${data.invoiceId}`,
    );
    return { invoiceId: data.invoiceId, followUpLink: data.followUpLink };
  }

  private post(token: string, body: string): Promise<Response> {
    return fetch(`${this.base()}/bonum-gateway/ecommerce/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept-Language': 'mn',
      },
      body,
    });
  }

  // ── Webhook баталгаажуулалт ──

  /** Bonum portal-д тохируулсан `x-webhook-secret`. Тохируулаагүй бол алгасна. */
  verifyWebhookSecret(secret: string | undefined): boolean {
    const expected = this.config.get<string>('bonum.webhookSecret');
    if (!expected) return true;
    return !!secret && secret === expected;
  }

  /**
   * `x-checksum-v2` = HMAC-SHA256(ТҮҮХИЙ бие, CHECKSUM_KEY) hex.
   *
   * ⚠ Заавал ТҮҮХИЙ бие дээр — JSON parse хийж дахин угсарвал зай/дараалал
   * зөрж checksum таарахгүй.
   */
  verifyChecksum(rawBody: string, checksum: string | undefined): boolean {
    const key = this.config.get<string>('bonum.checksumKey');
    if (!key || !checksum) return false;
    const digest = createHmac('sha256', key).update(rawBody, 'utf8').digest('hex');
    const a = Buffer.from(digest);
    const b = Buffer.from(checksum.trim().toLowerCase());
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Холболтыг шалгах (тохиргооны дэлгэцэд).
   *
   * ⚠ Анхдагчаар `force` хийхгүй. Урьд нь дуудалт бүрд шинэ токен авдаг
   * байсан — тохиргооны хуудсыг сэргээх бүрд Bonum-ын throttle-ыг зарцуулж
   * байлаа. Хүчинтэй токен байвал холболт БАТЛАГДСАН гэсэн үг.
   *
   * `force` нь зөвхөн ажилтан «холболт шалгах» товч дарсан үед — тэр
   * тохиолдолд ЖИНХЭНЭ шинэ auth хийж, креденшл солигдсоныг илрүүлнэ.
   */
  async ping(force = false): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.getToken(force);
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
