import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { PermanentError } from '../outbox/outbox.errors';

export interface LoyaltyCardBrief {
  serialNumber: string;
  code: string;
  barcode: string;
  status: string;
  expiresAt: string | null;
  usesLeft: number | null;
}

/** `GET /cards` жагсаалтын мөр — `cardBrief`-ээс өөр бүтэцтэй. */
export interface LoyaltyCardListRow {
  serialNumber: string;
  code: string;
  barcode: string;
  status: string;
  expiresAt: string | null;
  programId: string | null;
  programName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  /**
   * Apple Wallet-д нэмсэн төхөөрөмжийн тоо. 0 = push хүрэхгүй.
   * Хуучин хувилбарын Loopy үүнийг буцаахгүй — тиймээс заавал биш.
   */
  walletDevices?: number;
}

export interface AllowedPhoneRow {
  id: string;
  phone: string;
  name: string | null;
  note: string | null;
  used: boolean;
  cardId: string | null;
}

export interface CardField {
  key: string;
  label: string;
  value: string;
}

/**
 * Loopy Partner API-ийн клиент.
 *
 * ★ Wallet карттай холбоотой БҮХ зүйл Loopy талд байдаг — Apple сертификат,
 * төхөөрөмжийн push token, Google issuer. WinFit картад ШУУД хүрэх боломжгүй
 * тул бүх үйлдэл эндүүр дамжина (docs/06-loopy-partner-api.md).
 *
 * Дуудлага бүр outbox worker-ээс л явна — controller-оос шууд дуудахгүй.
 */
export interface LoyaltyProgramBrief {
  id: string;
  name: string;
  type: string;
  target: string | null;
  status: string;
}

export interface EnrollLink {
  programId: string;
  name: string;
  /** Жагсаалтын горим унтарсан бол ХЭН Ч энэ линкээр карт үүсгэж чадна. */
  enrollAllowlist: boolean;
  enrollUrl: string;
}

@Injectable()
export class LoyaltyClient {
  private readonly log = new Logger(LoyaltyClient.name);

  /** Rate limit — Loopy нь IP-д 90/мин. Бид 60/мин-д барина (нөөцтэй). */
  private windowStart = 0;
  private windowCount = 0;

  /** Stub горимын зөвшөөрөгдсөн дугаарууд — санах ойд. */
  private readonly stubPhones = new Map<string, AllowedPhoneRow>();

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * ⚠ `programId`-г ЭНД шалгахгүй: тэр нь env-ээс ч, DB-ийн тохиргооноос
   * ч ирж болно. Хаяг ба түлхүүр байвал программын жагсаалтыг татаж
   * админд сонгуулах боломжтой — өөрөөр хэлбэл холболт «тохируулсан».
   */
  isConfigured(): boolean {
    return !!(
      this.config.get<string>('loopy.apiUrl') &&
      this.config.get<string>('loopy.apiKey')
    );
  }

  private base(): string {
    return (this.config.getOrThrow<string>('loopy.apiUrl') as string).replace(
      /\/$/,
      '',
    );
  }

  /**
   * Ажиллах программын ID.
   *
   * Эрэмбэ: DB-ийн тохиргоо → `LOOPY_PROGRAM_ID` env. Тохиргоог админ
   * дэлгэцээс солиход deploy шаардахгүй; env нь зөвхөн нөөц утга.
   */
  private async programId(): Promise<string> {
    const chosen = await this.settings.get('loopy_program_id');
    const id = chosen ?? this.config.get<string>('loopy.programId');
    if (!id) {
      throw new ServiceUnavailableException(
        'Loopy программ сонгоогүй байна — Тохиргоо → Холболт хэсгээс сонгоно уу',
      );
    }
    return id;
  }

  /** `LOOPY_PROGRAM_ID` env-ийн нөөц утга — тохиргоо хоосон үед ажиллана. */
  envProgramId(): string | null {
    return this.config.get<string>('loopy.programId') ?? null;
  }

  /** Loopy дээрх идэвхтэй программууд — админ сонгоход. */
  async listPrograms(): Promise<LoyaltyProgramBrief[]> {
    const rows = await this.call<LoyaltyProgramBrief[]>('GET', '/programs');
    return Array.isArray(rows) ? rows : [];
  }

  /** Сонгосон программын enroll линк (QR, постер). */
  async enrollLink(): Promise<EnrollLink> {
    return this.call<EnrollLink>(
      'GET',
      `/programs/${await this.programId()}/enroll-link`,
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  Үйлдлүүд
  // ══════════════════════════════════════════════════════════════

  /** Зөвшөөрөгдсөн дугаар нэмэх — идемпотент (Loopy давхардлыг зөвшөөрнө). */
  async allowPhone(phone: string, name?: string, note?: string): Promise<void> {
    await this.call('POST', `/programs/${await this.programId()}/allowed-phones`, {
      phone,
      name,
      note,
    });
  }

  /**
   * Программын зөвшөөрөгдсөн дугаарын БҮТЭН жагсаалт.
   *
   * Loopy тал хуудаслалтгүй — бүгдийг нэг хариунд буцаана. Фитнесийн
   * хэмжээнд (мянга хүрэхгүй) асуудалгүй.
   */
  async listAllowedPhones(): Promise<AllowedPhoneRow[]> {
    const res = await this.call<AllowedPhoneRow[]>(
      'GET',
      `/programs/${await this.programId()}/allowed-phones`,
    );
    return Array.isArray(res) ? res : [];
  }

  async disallowPhone(phone: string): Promise<void> {
    await this.call(
      'DELETE',
      `/programs/${await this.programId()}/allowed-phones/${encodeURIComponent(phone)}`,
    );
  }

  /** Картын дуусах огноог ШУУД тавих. */
  async extendCard(
    serial: string,
    expiresAt: Date | null,
    note?: string,
  ): Promise<LoyaltyCardBrief & { changed: boolean }> {
    return this.call('POST', `/cards/${encodeURIComponent(serial)}/extend`, {
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      note,
    });
  }

  async setCardStatus(
    serial: string,
    status: 'active' | 'revoked',
    reason?: string,
  ): Promise<LoyaltyCardBrief & { changed: boolean }> {
    return this.call('POST', `/cards/${encodeURIComponent(serial)}/status`, {
      status,
      reason,
    });
  }

  /** Картын ард гарах талбарууд — БҮТНЭЭР солино. */
  async setCardFields(serial: string, fields: CardField[]): Promise<void> {
    await this.call('POST', `/cards/${encodeURIComponent(serial)}/fields`, {
      fields,
    });
  }

  /**
   * Нэг картад push мэдэгдэл.
   *
   * `appleDevices === 0` бол хэрэглэгч картаа Wallet-д нэмээгүй — мэдэгдэл
   * хүрэхгүй. Дуудагч тал үүнийг мэдэж «залгах» жагсаалтад оруулна.
   */
  async pushToCard(
    serial: string,
    message: string,
  ): Promise<{ pushed: boolean; appleDevices: number }> {
    return this.call('POST', `/cards/${encodeURIComponent(serial)}/push`, {
      message,
    });
  }

  async getCard(serial: string): Promise<LoyaltyCardBrief | null> {
    try {
      return await this.call('GET', `/cards/${encodeURIComponent(serial)}`);
    } catch (e) {
      if (e instanceof PermanentError) return null;
      throw e;
    }
  }

  /**
   * ӨӨРИЙН программын картуудыг хуудаслаж авах — шөнийн тулгалтад.
   *
   * Гишүүн бүрд тусад нь хүсэлт явуулахын оронд нэг дор татаж, утсаар нь
   * тулгана: 300 гишүүнд 300 хүсэлтийн оронд 3 хүсэлт болно.
   */
  async listProgramCards(
    page: number,
    limit = 100,
  ): Promise<{ items: LoyaltyCardListRow[]; total: number }> {
    const res = await this.call<{ items: LoyaltyCardListRow[]; total: number }>(
      'GET',
      `/cards?programId=${encodeURIComponent(await this.programId())}` +
        `&page=${page}&limit=${limit}`,
    );
    return { items: res.items ?? [], total: res.total ?? 0 };
  }

  /** Утсаар карт хайх — шөнийн тулгалтад. */
  async findCardsByPhone(phone: string): Promise<LoyaltyCardBrief[]> {
    const res = await this.call<{ items: LoyaltyCardBrief[] }>(
      'GET',
      `/cards?phone=${encodeURIComponent(phone)}&limit=10`,
    );
    return res.items ?? [];
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, detail: 'LOOPY_API_URL / KEY / PROGRAM_ID тохируулаагүй' };
    }
    try {
      await this.call('GET', '/programs');
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  Дотоод
  // ══════════════════════════════════════════════════════════════

  private async call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    // ★ STUB ГОРИМ — Loopy руу ОГТ ХҮРЭХГҮЙ.
    //
    // ⚠ Урьд нь `LOOPY_MODE` нь зөвхөн `main.ts`-ийн production
    // хамгаалалтад л уншигддаг байсан бөгөөд клиент түүнийг ОГТ
    // ХАРДАГГҮЙ байв. Үр дүнд `LOOPY_MODE=stub` тавьсан ч
    // `LOOPY_API_URL`/`KEY` байвал БОДИТ Loopy руу бичсээр байсан —
    // хөгжүүлэлтийн тестийн дугаар прод жагсаалтад орж байлаа.
    if (this.config.get<string>('gateways.loopy') === 'stub') {
      return this.stub<T>(method, path, body);
    }

    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Loopy холболт тохируулаагүй');
    }
    await this.throttle();

    const res = await fetch(`${this.base()}/partner/v1${path}`, {
      method,
      headers: {
        'x-api-key': this.config.getOrThrow<string>('loopy.apiKey'),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const message = `Loopy ${method} ${path} → ${res.status} ${text.slice(0, 300)}`;
      // 4xx нь дахин илгээхэд ЭДГЭРЭХГҮЙ (буруу өгөгдөл, эрхгүй, олдсонгүй).
      // 429 бол хэтэрсэн хүсэлт — түр зуурын, retry хийнэ.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        this.log.error(message);
        throw new PermanentError(message);
      }
      this.log.warn(message);
      throw new Error(message);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Хүсэлтийн хурдыг барих.
   *
   * Сануулга илгээх үед олон зуун карт руу дараалан хүсэлт явна — Loopy-гийн
   * 90/мин хязгаарт хүрвэл `429` авч, outbox дэмий retry хийнэ. Тиймээс
   * клиент талдаа хүлээнэ.
   */
  /**
   * Loopy-г дуурайх — санах ойд.
   *
   * Хоосон объект буцаавал дуудагч талууд эвдэрнэ (жагсаалт хүлээж
   * байсан газар `undefined` ирнэ). Тиймээс метод бүрийн ХҮЛЭЭЖ БУЙ
   * хэлбэрийг зөв буцаана.
   *
   * Жагсаалт, картыг санах ойд барина — ингэснээр «нэмсэн дугаар
   * жагсаалтад харагдана», «карт үүсгээд төлөв нь солигдоно» гэсэн
   * урсгалыг терминалын stub шиг бодитоор турших боломжтой.
   */
  private stub<T>(method: string, path: string, body?: unknown): T {
    const b = (body ?? {}) as Record<string, unknown>;
    this.log.debug(`[stub] ${method} ${path}`);

    // ── Зөвшөөрөгдсөн дугаар ──
    if (path.includes('/allowed-phones')) {
      if (method === 'POST') {
        const phone = String(b.phone ?? '');
        if (phone) {
          this.stubPhones.set(phone, {
            id: `stub-${phone}`,
            phone,
            name: (b.name as string) ?? null,
            note: (b.note as string) ?? null,
            // Карт үүсээгүй гэж дуурайна — жинхэнэ Loopy дээр гишүүн
            // өөрөө enroll хийх хүртэл ийм байдаг.
            used: false,
            cardId: null,
          });
        }
        return undefined as T;
      }
      if (method === 'DELETE') {
        // Зам нь `.../allowed-phones/99001122`
        this.stubPhones.delete(decodeURIComponent(path.split('/').pop() ?? ''));
        return undefined as T;
      }
      return [...this.stubPhones.values()] as T;
    }

    // ── Программ ──
    if (path.endsWith('/enroll-link')) {
      return {
        programId: 'stub-program',
        name: 'WinFit (stub)',
        enrollAllowlist: true,
        enrollUrl: 'https://example.invalid/enroll/stub',
      } as T;
    }
    if (path === '/programs') {
      return [
        {
          id: this.config.get<string>('loopy.programId') ?? 'stub-program',
          name: 'WinFit (stub)',
          type: 'pass',
          target: null,
          status: 'active',
        },
      ] as T;
    }

    // ── Карт ──
    //
    // ⚠ Карт ҮҮСГЭХГҮЙ. Жинхэнэ Loopy дээр картыг ГИШҮҮН өөрөө
    // enroll хийж үүсгэдэг (WinFit үүсгэдэггүй) тул stub нь «карт
    // хараахан алга» гэж хэлэх нь бодит байдалд ойр.
    if (path.startsWith('/cards')) {
      if (path.includes('?')) return { items: [], total: 0 } as T;
      if (method === 'GET') throw new PermanentError('[stub] карт алга');
      return { changed: true, pushed: false, appleDevices: 0 } as T;
    }

    return undefined as T;
  }

  private async throttle(): Promise<void> {
    const limit = this.config.get<number>('loopy.rateLimitPerMin') ?? 60;
    const now = Date.now();
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    if (this.windowCount >= limit) {
      const wait = 60_000 - (now - this.windowStart) + 50;
      this.log.debug(`Loopy rate limit — ${wait}мс хүлээж байна`);
      await new Promise((r) => setTimeout(r, wait));
      this.windowStart = Date.now();
      this.windowCount = 0;
    }
    this.windowCount++;
  }
}
