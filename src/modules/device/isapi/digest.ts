import { createHash, randomBytes } from 'crypto';

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
  ): Promise<{ status: number; text: string }> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;
    // `uri` нь ЗАМ (query-тэйгээ), бүтэн URL биш — эс тэгвээс hash таарахгүй.
    const uri = path;

    const send = (auth?: string): Promise<Response> =>
      fetch(url, {
        method,
        headers: {
          ...headers,
          ...(auth ? { Authorization: auth } : {}),
          ...(body ? { 'Content-Type': headers['Content-Type'] ?? 'application/json' } : {}),
        },
        body,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
      });

    // 1) Кэшлэсэн challenge байвал шууд креденшлтэй илгээнэ.
    let res: Response;
    if (this.challenge) {
      res = await send(
        buildHeader(this.challenge, this.opts.user, this.opts.password, method, uri),
      );
      if (res.status !== 401) return this.finish(res);
      // nonce хуучирсан байж болно — challenge-ыг шинэчилнэ.
      this.challenge = null;
    } else {
      res = await send();
    }

    // 2) Challenge авах.
    if (res.status !== 401) return this.finish(res);
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
    return this.finish(res);
  }

  private async finish(res: Response) {
    return { status: res.status, text: await res.text() };
  }

  /** Нууц үг солигдсон эсвэл гараар дахин холбогдох үед. */
  reset(): void {
    this.challenge = null;
  }
}
