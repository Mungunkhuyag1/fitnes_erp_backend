import { createHash, randomBytes } from 'crypto';
import { DeviceUnreachableError } from '../device.gateway';
import { networkReason } from './unreachable';

/**
 * HTTP Digest authentication.
 *
 * Node-ийн `fetch` нь digest-ийг ДЭМЖДЭГГҮЙ, Hikvision нь Basic-ийг хүлээж
 * авдаггүй. Тиймээс гараар хэрэгжүүлэв.
 *
 * ⚠ ХАМГИЙН ЧУХАЛ ДҮРЭМ: буруу нууц үгээр дахин оролдож БОЛОХГҮЙ.
 * Hikvision нь 5 удаа амжилтгүй нэвтрэхэд IP-г 30 МИНУТ блоклодог
 * («Illegal login lock»). Retry loop нь өөрийгөө түгжинэ.
 *
 * Тиймээс энэ клиент:
 *   • Challenge (401 → nonce авах) НЭГ л удаа хийнэ
 *   • Креденшлтэй илгээсний дараа дахин 401 ирвэл — нууц үг БУРУУ гэж үзэж
 *     `DigestAuthError` шиднэ (дуудагч тал retry хийхгүй)
 *   • nonce-ыг КЭШЛЭНЭ — дуудлага бүрд 401 round-trip хийхгүй
 */
export class DigestAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DigestAuthError';
  }
}

interface Challenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
  /** Энэ nonce-оор хэдэн хүсэлт илгээснийг тоолно (`nc`). */
  count: number;
}

const md5 = (v: string): string => createHash('md5').update(v).digest('hex');

/** `WWW-Authenticate: Digest realm="x", nonce="y", qop="auth"` задлах. */
function parseChallenge(header: string): Challenge | null {
  if (!/^digest/i.test(header.trim())) return null;
  const out: Record<string, string> = {};
  // key="value" эсвэл key=value
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header)) !== null) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  }
  if (!out.realm || !out.nonce) return null;
  return {
    realm: out.realm,
    nonce: out.nonce,
    qop: out.qop,
    opaque: out.opaque,
    algorithm: out.algorithm,
    count: 0,
  };
}

function buildHeader(
  c: Challenge,
  user: string,
  password: string,
  method: string,
  uri: string,
): string {
  c.count += 1;
  const nc = c.count.toString(16).padStart(8, '0');
  const cnonce = randomBytes(8).toString('hex');

  let ha1 = md5(`${user}:${c.realm}:${password}`);
  if (c.algorithm?.toLowerCase() === 'md5-sess') {
    ha1 = md5(`${ha1}:${c.nonce}:${cnonce}`);
  }
  const ha2 = md5(`${method}:${uri}`);

  const qop = c.qop?.split(',')[0]?.trim();
  const response = qop
    ? md5(`${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${c.nonce}:${ha2}`);

  const parts = [
    `username="${user}"`,
    `realm="${c.realm}"`,
    `nonce="${c.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (c.opaque) parts.push(`opaque="${c.opaque}"`);
  if (c.algorithm) parts.push(`algorithm=${c.algorithm}`);
  return `Digest ${parts.join(', ')}`;
}

export interface DigestOptions {
  user: string;
  password: string;
  /** Хүсэлтийн хугацаа (мс). Терминал удаан хариулж болно. */
  timeoutMs?: number;
  /**
   * Хүсэлт БҮРД нэмэгдэх толгой — Cloudflare Access service token.
   *
   * ⚠ Digest auth-ийн ХОЁР алхамд хоёуланд нь орох ёстой: эхний
   * (challenge авах) хүсэлт токенгүй явбал Cloudflare 403 буцаах ба
   * терминалын 401 хэзээ ч ирэхгүй — nonce авч чадахгүй.
   */
  defaultHeaders?: Record<string, string>;
}

/** Нэг хүсэлтэд л хамаарах тохиргоо. */
export interface RequestOpts {
  /**
   * Энэ хүсэлтийн хугацаа (мс) — клиентийн анхдагчийг ДАРНА.
   *
   * ⚠ Яагаад хэрэгтэй вэ: царай уншуулах (`CaptureFaceData`) нь хүн
   * терминалын өмнө зогсохыг ХҮЛЭЭДЭГ. 15 секундээр тасалбал хүн
   * ойртож амжаагүй байхад л алдаа буцна. Бусад дуудлагын хугацааг
   * уртасгавал терминал унтарсан үед бүх зүйл гацна — тиймээс
   * ерөнхийд нь биш, ЗӨВХӨН тэр дуудлагад.
   */
  timeoutMs?: number;

  /**
   * Гаднаас ЗОГСООХ дохио — ажилтан «Цуцлах» дарахад.
   *
   * ⚠ Хугацааны дохиотой ХАМТ ажиллана (`AbortSignal.any`). Зөвхөн
   * нэгийг нь өгвөл нөгөө нь ажиллахаа болино: цуцлалт нэмснээр
   * timeout алга болвол терминал унтарсан үед хүсэлт мөнхөд гацна.
   */
  signal?: AbortSignal;
}

/**
 * Гаднаас ирсэн цуцлалт болон хугацааг НЭГТГЭНЭ.
 *
 * ⚠ ХОЁУЛАНГ нь дамжуулна. Зөвхөн цуцлалтыг өгвөл timeout алга болж,
 * терминал унтарсан үед хүсэлт мөнхөд гацна.
 *
 * ⚠ `AbortSignal.any` нь Node 20-оос эхэлсэн. Хуучин орчинд унахаас
 * сэргийлж хугацаа руу уначихна — цуцлалт ажиллахгүй болохоос биш,
 * системийн ажиллагаа зогсохгүй.
 */
function abortSignal(
  opts: { timeoutMs?: number; signal?: AbortSignal },
  fallbackMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? fallbackMs);
  if (!opts.signal) return timeout;
  return typeof AbortSignal.any === 'function'
    ? AbortSignal.any([timeout, opts.signal])
    : timeout;
}

/**
 * Digest auth-тай HTTP клиент — нэг төхөөрөмжид нэг instance.
 *
 * `nonce`-ыг instance дотор кэшлэнэ. Хэрэв терминал nonce-оо хүчингүй
 * болговол (`stale=true` эсвэл дахин 401) НЭГ удаа шинэчилж дахин оролдоно —
 * энэ нь нууц үгийн алдаа БИШ тул түгжигдэх эрсдэлгүй.
 */
export class DigestClient {
  private challenge: Challenge | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly opts: DigestOptions,
  ) {}

  async request(
    method: string,
    path: string,
    body?: string,
    headers: Record<string, string> = {},
    opts: RequestOpts = {},
  ): Promise<{ status: number; text: string }> {
    const res = await this.exec(method, path, body, headers, opts);
    return { status: res.status, text: await res.text() };
  }

  /**
   * ХОЁРТЫН хариу — зураг татахад.
   *
   * ⚠ `request()` нь `res.text()` дууддаг: JPEG-ийг мөр болгон уншвал
   * байт нь гажиж, буцааж сэргээх боломжгүй болно.
   */
  async requestBytes(
    method: string,
    path: string,
    opts: RequestOpts & {
      /** Хүсэлтийн бие — XML/JSON мөр (`CaptureFaceData` гэх мэт). */
      body?: string | Buffer;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ status: number; bytes: Buffer; contentType: string | null }> {
    const res = await this.exec(
      method,
      path,
      opts.body,
      opts.headers ?? {},
      opts,
    );
    return {
      status: res.status,
      bytes: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type'),
    };
  }

  /**
   * ХОЁРТЫН БИЕТЭЙ хүсэлт — `multipart/form-data` (царай илгээх).
   *
   * ⚠ Биеийг мөр болгож илгээж БОЛОХГҮЙ: JPEG-ийн байт UTF-8-аар
   * гажиж, терминал «зураг таниагүй» гэж буцаана.
   */
  async requestBinary(
    method: string,
    path: string,
    body: Buffer,
    headers: Record<string, string> = {},
    opts: RequestOpts = {},
  ): Promise<{ status: number; text: string }> {
    const res = await this.exec(method, path, body, headers, opts);
    return { status: res.status, text: await res.text() };
  }

  /** Digest гар барилтыг гүйцэтгээд ТҮҮХИЙ хариуг буцаана. */
  private async exec(
    method: string,
    path: string,
    body?: string | Buffer,
    headers: Record<string, string> = {},
    opts: RequestOpts = {},
  ): Promise<Response> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;
    // `uri` нь ЗАМ (query-тэйгээ), бүтэн URL биш — эс тэгвээс hash таарахгүй.
    const uri = path;

    /*
     * ⚠ `Buffer`-ыг `fetch` шууд хүлээж авдаггүй (TS-ийн `BodyInit`-д
     * `Buffer` байхгүй). Энгийн `ArrayBuffer` дээр суурилсан
     * `Uint8Array` болгож хөрвүүлнэ — байт өөрчлөгдөхгүй.
     */
    const payload =
      body === undefined || typeof body === 'string'
        ? body
        : new Uint8Array(
            body.buffer.slice(
              body.byteOffset,
              body.byteOffset + body.byteLength,
            ) as ArrayBuffer,
          );

    /*
     * ⚠ СҮЛЖЭЭНИЙ ДОГОЛДЛЫГ ЭНД БАРЬЖ НЭРЛЭНЭ.
     *
     * `fetch` нь `TypeError: fetch failed` гэж шиддэг бөгөөд жинхэнэ
     * шалтгаан нь `cause.code` дотор нуугдана. Нэрлээгүй бол дэлгэц
     * дээр «fetch failed» гэж гарч, ажилтан юу хийхээ мэдэхгүй.
     */
    const send = async (auth?: string): Promise<Response> => {
      try {
        return await rawSend(auth);
      } catch (e) {
        const reason = networkReason(e);
        if (reason) throw new DeviceUnreachableError(reason);
        throw e;
      }
    };

    const rawSend = (auth?: string): Promise<Response> =>
      fetch(url, {
        method,
        headers: {
          ...(this.opts.defaultHeaders ?? {}),
          ...headers,
          ...(auth ? { Authorization: auth } : {}),
          ...(body ? { 'Content-Type': headers['Content-Type'] ?? 'application/json' } : {}),
        },
        body: payload,
        signal: abortSignal(opts, this.opts.timeoutMs ?? 15_000),
      });

    // 1) Кэшлэсэн challenge байвал шууд креденшлтэй илгээнэ.
    let res: Response;
    if (this.challenge) {
      res = await send(
        buildHeader(this.challenge, this.opts.user, this.opts.password, method, uri),
      );
      if (res.status !== 401) return res;
      // nonce хуучирсан байж болно — challenge-ыг шинэчилнэ.
      this.challenge = null;
    } else {
      res = await send();
    }

    // 2) Challenge авах.
    if (res.status !== 401) return res;
    const header = res.headers.get('www-authenticate');
    if (!header) {
      throw new DigestAuthError('Терминал WWW-Authenticate буцаасангүй');
    }
    const challenge = parseChallenge(header);
    if (!challenge) {
      throw new DigestAuthError(`Digest challenge задлагдсангүй: ${header}`);
    }
    this.challenge = challenge;

    // 3) Креденшлтэй НЭГ удаа илгээнэ.
    res = await send(
      buildHeader(challenge, this.opts.user, this.opts.password, method, uri),
    );

    if (res.status === 401) {
      // ⛔ Креденшл өгсөн хойно 401 = нууц үг/нэр БУРУУ. ДАХИН ОРОЛДОХГҮЙ —
      // 5 удаа буруу оруулбал IP 30 минут түгжигдэнэ.
      this.challenge = null;
      throw new DigestAuthError(
        'Терминалын нэвтрэх нэр/нууц үг буруу байна. ' +
          '⚠ ДАХИН БҮҮ ОРОЛД — 5 удаа буруу оруулбал IP 30 минут түгжигдэнэ.',
      );
    }
    return res;
  }

  /** Нууц үг солигдсон эсвэл гараар дахин холбогдох үед. */
  reset(): void {
    this.challenge = null;
  }
}
