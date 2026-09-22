import { Logger } from '@nestjs/common';

/**
 * Meta Graph API-гийн НИМГЭН клиент.
 *
 * ★ ЯАГААД БЭЛЭН САН АШИГЛААГҮЙ ВЭ
 *
 * Хайлт хийхэд Messenger-т зориулсан хоёр багц (`messaging-api-messenger`,
 * `fb-messenger-bot-api`) нь 2022 оноос хойш ШИНЭЧЛЭГДЭЭГҮЙ. Хэвээр
 * арчлагдаж байгаа цорын ганц албан ёсны багц нь
 * `facebook-nodejs-business-sdk` — тэр нь РЕКЛАМЫН (Marketing API)
 * SDK бөгөөд Messenger нь түүний гол зорилго биш, бас Graph-ийн өөр
 * хувилбар дээр байна.
 *
 * Бидэнд хэрэгтэй гадаргуу нь ДӨРВӨН дуудлага. Төслийн бусад гадаад
 * холболтууд (`isapi.client.ts`, `loyalty.client.ts`, `bonum.service.ts`)
 * бүгд энгийн `fetch`-ээр бичигдсэн — үүнийг мөн адил.
 */

/**
 * ⚠ ХУВИЛБАРЫГ НЭГ ГАЗАР. Meta нь хувилбар бүрийг ~2 жил дэмждэг тул
 * үе үе өсгөх шаардлагатай болно.
 */
const GRAPH = 'https://graph.facebook.com/v25.0';

/** Гадаад дуудлага хэзээ ч мөнхөд өлгөгдөж болохгүй. */
const TIMEOUT_MS = 15_000;

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    /** Meta-гийн алдааны код — 190 = токен хүчингүй, 10 = эрх дутуу. */
    readonly code?: number,
  ) {
    super(`Meta ${status}: ${detail}`);
    this.name = 'MetaApiError';
  }
}

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number };
}

export class MetaClient {
  private readonly log = new Logger(MetaClient.name);

  constructor(private readonly token: string) {}

  private async call<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const url = `${GRAPH}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(this.token)}`;
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Graph үргэлж JSON буцаадаг; биш бол доорх алдаанд түүхийг нь өгнө.
    }

    if (!res.ok) {
      const e = (parsed as GraphError)?.error;
      throw new MetaApiError(
        res.status,
        e?.message ?? text.slice(0, 300),
        e?.code,
      );
    }
    return parsed as T;
  }

  /**
   * Токен хүчинтэй эсэх + хуудасны нэр.
   *
   * Тохиргоо ХАДГАЛАХААС ӨМНӨ дуудна: буруу токеныг хадгалвал webhook
   * ирсээр байгаад хариу илгээх бүрд унана.
   */
  async me(): Promise<{ id: string; name: string }> {
    return this.call<{ id: string; name: string }>('/me?fields=id,name');
  }

  /**
   * Хэрэглэгчийн профайл.
   *
   * ⚠ Зөвхөн НЭР ба ЗУРАГ. Messenger утас, и-мэйл ӨГДӨГГҮЙ — гишүүнтэй
   * холбохыг ажилтан гараар хийх ёстойн шалтгаан нь энэ.
   *
   * ⚠ Профайл татагдахгүй байх нь ХЭВИЙН: хэрэглэгч нууцлалаа хаасан,
   * эсвэл апп нь хараахан батлагдаагүй байж болно. Тиймээс алдааг
   * дээш шиднэ — дуудагч нь `null` болгоно.
   */
  async profile(psid: string): Promise<{ name?: string; picture?: string }> {
    const r = await this.call<{
      name?: string;
      first_name?: string;
      last_name?: string;
      profile_pic?: string;
    }>(`/${psid}?fields=name,first_name,last_name,profile_pic`);
    return {
      name:
        r.name ??
        [r.first_name, r.last_name].filter(Boolean).join(' ') ??
        undefined,
      picture: r.profile_pic,
    };
  }

  /**
   * Мессеж илгээх.
   *
   * ★ ЦОНХНЫ ДҮРЭМ (`docs/17` §3)
   *
   *   < 24 цаг   → `RESPONSE`  — чөлөөтэй
   *   24ц – 7 хоног → `MESSAGE_TAG` + `HUMAN_AGENT` — ХҮН гараар хариулж
   *                   байгаа тохиолдолд л зөвшөөрөгдөнө
   *   > 7 хоног  → боломжгүй
   *
   * ⚠ `HUMAN_AGENT` тэг нь тусдаа зөвшөөрөл шаарддаг бөгөөд App Review
   * -гүй бол Meta татгалзана. Тиймээс алдааг барьж, ажилтанд
   * ойлгомжтой хэлэх ёстой — чимээгүй бүтэлгүйтэх ёсгүй.
   */
  async send(
    pageId: string,
    psid: string,
    text: string,
    opts: { humanAgent?: boolean } = {},
  ): Promise<{ message_id: string }> {
    return this.call<{ message_id: string }>(`/${pageId}/messages`, {
      method: 'POST',
      body: {
        recipient: { id: psid },
        ...(opts.humanAgent
          ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }
          : { messaging_type: 'RESPONSE' }),
        message: { text },
      },
    });
  }
}
