import type { RawAcsEvent } from './acs-event.mapper';

/**
 * Терминалын түлхэлтийг задлах.
 *
 * ★ ЯАГААД ТУСДАА ФАЙЛ ВЭ
 *
 * Hikvision нэг өгөгдлийг ГУРВАН өөр хэлбэрээр илгээж чадна. Аль нь
 * ирэхийг firmware, «Event Format» тохиргоо, зураг хавсаргасан эсэх
 * гурав тодорхойлно:
 *
 *   1. `application/json`
 *   2. `application/xml`  (EventNotificationAlert)
 *   3. `multipart/form-data`  — дээрх хоёрын нэг + царайны зураг
 *
 * ⚠ БҮР НЭРС НЬ ӨӨР. Татаж авдаг `AcsEvent` (ISAPI Search) нь
 * `major` / `minor` / `time` гэж өгдөг бол ТҮЛХЭЛТ нь
 * `majorEventType` / `subEventType` / `dateTime` гэж өгнө. Ижил
 * өгөгдөл, өөр нэр. Хөрвүүлэгч нь эхнийхийг хүлээдэг тул түлхэлтийг
 * шууд өгвөл `minor` нь undefined болж ЧИМЭЭГҮЙ хаягдана.
 *
 * Тиймээс энд бүх хэлбэрийг НЭГ дүрд (`RawAcsEvent`) хөрвүүлнэ.
 */

export interface ParsedPayload {
  /** Юу ирснийг оношлоход — логд бичигдэнэ. */
  format: 'json' | 'xml' | 'multipart' | 'empty' | 'unknown';
  events: RawAcsEvent[];
}

/** `<tag>утга</tag>` — нэрийн орон зайг (`ns:tag`) тооцно. */
function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(
    `<(?:[\\w.-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`,
    'i',
  ).exec(xml);
  return m ? m[1].trim() : undefined;
}

const num = (v?: string): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Түлхэлтийн нэрсийг татагчийн нэрс рүү буулгана.
 *
 * `outerTime` нь гаднах дүнгийн `dateTime` — дотоод хэсэгт цаг байхгүй
 * тохиолдол элбэг.
 */
function normalize(
  o: Record<string, unknown>,
  outerTime?: string,
): RawAcsEvent {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
    return undefined;
  };
  const asNum = (v: unknown): number | undefined => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) ? n : undefined;
  };

  const time = (pick('time', 'dateTime') as string | undefined) ?? outerTime;

  return {
    ...o,
    major: asNum(pick('major', 'majorEventType')),
    minor: asNum(pick('minor', 'subEventType')),
    time,
    employeeNoString: pick('employeeNoString', 'employeeNo') as
      | string
      | undefined,
    currentVerifyMode: pick('currentVerifyMode', 'verifyMode') as
      | string
      | undefined,
  };
}

function fromJson(body: unknown): RawAcsEvent[] {
  if (Array.isArray(body)) {
    return body.map((x) => normalize(x as Record<string, unknown>));
  }
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  const outerTime = (o.dateTime ?? o.time) as string | undefined;
  const inner =
    (o.AccessControllerEvent as Record<string, unknown> | undefined) ??
    (o.AcsEvent as Record<string, unknown> | undefined);
  return [normalize(inner ?? o, outerTime)];
}

function fromXml(xml: string): RawAcsEvent[] {
  const outerTime = tag(xml, 'dateTime');
  const inner = tag(xml, 'AccessControllerEvent') ?? xml;
  const ev: RawAcsEvent = {
    major: num(tag(inner, 'majorEventType') ?? tag(inner, 'major')),
    minor: num(tag(inner, 'subEventType') ?? tag(inner, 'minor')),
    time: tag(inner, 'time') ?? outerTime,
    employeeNoString: tag(inner, 'employeeNoString') ?? tag(inner, 'employeeNo'),
    name: tag(inner, 'name'),
    currentVerifyMode: tag(inner, 'currentVerifyMode'),
    serialNo: num(tag(inner, 'serialNo')),
    doorNo: num(tag(inner, 'doorNo')),
    pictureURL: tag(inner, 'pictureURL'),
  };
  return [ev];
}

/**
 * multipart-ийг гараар задална.
 *
 * ЯАГААД САН АШИГЛААГҮЙ ВЭ: `multer` зэрэг нь файл бичих, түр хавтас,
 * хязгаарын тохиргоо дагуулж ирдэг. Бидэнд ЗӨВХӨН эхний текст хэсэг
 * хэрэгтэй (зургийг зориудаар хаядаг — docs/04 §1.2). Хилийн мөрөөр
 * хуваах нь хэдхэн мөр.
 */
function fromMultipart(raw: Buffer, contentType: string): RawAcsEvent[] {
  const b = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (b?.[1] ?? b?.[2])?.trim();
  if (!boundary) return [];

  for (const part of raw.toString('binary').split(`--${boundary}`)) {
    const sep = part.indexOf('\r\n\r\n');
    if (sep === -1) continue;
    const headers = part.slice(0, sep).toLowerCase();
    // Зургийн хэсгийг алгасна — хоёртын өгөгдлийг задлах гэж оролдохгүй.
    if (headers.includes('image/')) continue;

    const text = Buffer.from(part.slice(sep + 4), 'binary')
      .toString('utf8')
      .replace(/\r\n--$/, '')
      .trim();
    if (!text) continue;

    try {
      if (text.startsWith('{') || text.startsWith('[')) {
        return fromJson(JSON.parse(text));
      }
      if (text.startsWith('<')) return fromXml(text);
    } catch {
      // Дараагийн хэсгийг үзнэ — эхнийх нь тайлбар мөр байж болно.
    }
  }
  return [];
}

/**
 * Эвентийн код (`minor`) олдоогүй мөрийг хаяна.
 *
 * ЯАГААД: код байхгүй мөр нь «задалсан» гэж тоологдвол оношлогоо
 * худлаа болно — «1 эвент задалсан, 0 бүртгэсэн» гэж харагдаад кодын
 * алдаа мэт сэтгэгдэл төрүүлнэ. Үнэндээ бүтэц нь таараагүй.
 */
const real = (evs: RawAcsEvent[]): RawAcsEvent[] =>
  evs.filter((e) => e.minor !== undefined);

export function parseWebhookPayload(
  contentType: string,
  body: unknown,
): ParsedPayload {
  const ct = (contentType || '').toLowerCase();

  if (Buffer.isBuffer(body)) {
    if (body.length === 0) return { format: 'empty', events: [] };
    if (ct.includes('multipart/'))
      return { format: 'multipart', events: real(fromMultipart(body, ct)) };

    const text = body.toString('utf8').trim();
    if (text.startsWith('<'))
      return { format: 'xml', events: real(fromXml(text)) };
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return { format: 'json', events: real(fromJson(JSON.parse(text))) };
      } catch {
        return { format: 'unknown', events: [] };
      }
    }
    return { format: 'unknown', events: [] };
  }

  if (typeof body === 'string') {
    const text = body.trim();
    if (text.startsWith('<'))
      return { format: 'xml', events: real(fromXml(text)) };
    return { format: 'unknown', events: [] };
  }

  if (body && typeof body === 'object') {
    if (Object.keys(body).length === 0) return { format: 'empty', events: [] };
    return { format: 'json', events: real(fromJson(body)) };
  }

  return { format: 'empty', events: [] };
}
