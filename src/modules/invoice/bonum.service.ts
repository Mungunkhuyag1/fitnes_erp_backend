import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { BonumTokenStoreFactory } from './bonum-token.store';

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

interface AuthResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * Bonum web payment (PSP) интеграци — ЖИНХЭНЭ дуудлага.
 *
 *   auth    : GET  /bonum-gateway/ecommerce/auth/create
 *             (Authorization: AppSecret …, X-TERMINAL-ID: …)
 *             → { accessToken, refreshToken, expiresIn }
 *   refresh : GET  /bonum-gateway/ecommerce/auth/refresh
 *             (Authorization: Bearer <refreshToken>)
 *   invoice : POST /bonum-gateway/ecommerce/invoices
 *             (Authorization: Bearer <accessToken>)
 *   webhook : x-checksum-v2 = HMAC-SHA256(rawBody, CHECKSUM_KEY) hex
 *
 * ⚠ Bonum-ын auth нь ХЯЗГААРТАЙ (throttle). Дөрвөн давхар хамгаалалт:
 *
 *   1. Санах ойн кэш   — ердийн хүсэлт сан хүртэл ч очихгүй.
 *   2. Гадаад сан      — Redis эсвэл Postgres; restart-д амьд үлдэнэ.
 *   3. Refresh token   — access дуусахад `auth/create` БИШ `auth/refresh`.
 *                        Refresh нь ≈24 цаг настай тул `auth/create` нь
 *                        өдөрт нэг л удаа дуудагдана.
 *   4. Single-flight   — зэрэг ирсэн хүсэлтээс НЭГ нь л auth хийнэ.
 *
 * Амжилтгүй болбол backoff тавьж түр завсарлана — унасан үйлчилгээ рүү
 * секунд тутам цохихгүй.
 */
@Injectable()
export class BonumService {
  /** Auth амжилтгүй болоход хэдэн секунд завсарлах. 429 бол уртаар. */
  private static readonly BACKOFF_SEC = 20;
  private static readonly BACKOFF_THROTTLED_SEC = 120;
  /** Хүсэлтийн хугацаа — Bonum хариугүй өлгөөстэй байхаас сэргийлнэ. */
  private static readonly TIMEOUT_MS = 15_000;

  private readonly log = new Logger(BonumService.name);
  private token: { value: string; expiresAt: number } | null = null;
  /** Нэг процесс дотор давхар auth явуулахгүй (single-flight). */
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly stores: BonumTokenStoreFactory,
  ) {}

  private get store() {
    return this.stores.store;
  }

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

  private async resolveToken(force: boolean): Promise<string> {
    // Нөгөө процесс (replica) саяхан шинэчилсэн байж болно.
    if (!force) {
      const cached = await this.store.getAccess().catch(() => null);
      if (cached) {
        this.token = { value: cached, expiresAt: Date.now() + 60_000 };
        return cached;
      }
    }

    const backoff = await this.store.getBackoff().catch(() => null);
    if (backoff) {
      const sec = Math.ceil((backoff.until.getTime() - Date.now()) / 1000);
      throw new ServiceUnavailableException(
        `Bonum түр хүртээмжгүй байна — ${sec}с дараа дахин оролдоно уу` +
          (backoff.error ? ` (${backoff.error})` : ''),
      );
    }

    // ★ Эхлээд refresh — `auth/create` нь илүү чанга хязгаартай.
    const refresh = await this.store.getRefresh().catch(() => null);
    let data: AuthResponse | null = null;
    if (refresh) {
      try {
        data = await this.authRefresh(refresh);
      } catch (e) {
        // Refresh хүчингүй бол энэ нь алдаа биш — шинээр авна.
        this.log.warn(
          `Bonum refresh амжилтгүй, шинэ токен авна: ${(e as Error).message}`,
        );
      }
    }

    if (!data) {
      try {
        data = await this.authCreate();
      } catch (e) {
        const err = e as Error & { status?: number };
        const sec =
          err.status === 429
            ? BonumService.BACKOFF_THROTTLED_SEC
            : BonumService.BACKOFF_SEC;
        await this.store.setBackoff(sec, err.message).catch(() => undefined);
        this.log.warn(`Bonum auth унав — ${sec}с завсарлана: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
    }

    // ⚠ TTL-ийг Bonum-ын `expiresIn`-ээс авна. Тогтмол утга бичвэл токен
    // эрт хүчингүй болоход кэш «хүчинтэй» гэж худал хэлж 401 үүснэ.
    // 60 секундын нөөц — хүсэлт явж байх зуур хүчингүй болохоос сэргийлнэ.
    const ttlSec = Math.max(60, (data.expiresIn ?? 1800) - 60);
    await this.store
      .save(data.accessToken, ttlSec, data.refreshToken ?? null)
      .catch((e: unknown) =>
        // Сан унасан ч токен нь хүчинтэй — санах ойгоор үргэлжилнэ.
        this.log.warn(`Токен хадгалж чадсангүй: ${(e as Error).message}`),
      );
    this.token = { value: data.accessToken, expiresAt: Date.now() + ttlSec * 1000 };
    this.log.log(
      `Bonum токен авав (${ttlSec}с, ${data.refreshToken ? 'refresh-тэй' : 'refresh-гүй'})`,
    );
    return data.accessToken;
  }

  /** Шинэ токен — ХЯЗГААРТАЙ эндпойнт, боломжтой бол refresh хэрэглэ. */
  private authCreate(): Promise<AuthResponse> {
    return this.auth(`${this.base()}/bonum-gateway/ecommerce/auth/create`, {
      Authorization: `AppSecret ${this.config.getOrThrow<string>('bonum.appSecret')}`,
      'X-TERMINAL-ID': this.config.getOrThrow<string>('bonum.terminalId'),
    });
  }

  private authRefresh(refreshToken: string): Promise<AuthResponse> {
    return this.auth(`${this.base()}/bonum-gateway/ecommerce/auth/refresh`, {
      Authorization: `Bearer ${refreshToken}`,
    });
  }

  private async auth(
    url: string,
    headers: Record<string, string>,
  ): Promise<AuthResponse> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(BonumService.TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(`Bonum-тай холбогдож чадсангүй (${(e as Error).name})`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // ⚠ Токеныг ХЭЗЭЭ Ч лог руу бичихгүй — зөвхөн статус, алдааны бие.
      this.log.error(`Bonum auth ${res.status}: ${body.slice(0, 200)}`);
      throw Object.assign(
        new Error(
          res.status === 429
            ? 'Bonum хүсэлтийн хязгаарт хүрсэн (auth 429)'
            : `Bonum-тай холбогдож чадсангүй (auth ${res.status})`,
        ),
        { status: res.status },
      );
    }
    const data = (await res.json()) as AuthResponse;
    if (!data.accessToken) throw new Error('Bonum accessToken буцаасангүй');
    return data;
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
      // Токен хүчингүй болжээ — САНГААС ч устгана, эс бөгөөс бусад
      // процесс тэр хуучин токеныг уншсаар байна.
      this.log.warn('Bonum invoice 401 — токен сэргээж дахин илгээж байна');
      this.token = null;
      await this.store.clear().catch(() => undefined);
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
