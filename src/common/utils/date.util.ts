/**
 * Цагийн бүстэй ажиллах туслахууд.
 *
 * DB-д бүх огноо UTC (`timestamptz`) байна. Гэхдээ бизнесийн дүрэм бүгд
 * ЛОКАЛ өдрөөр тодорхойлогддог:
 *   • «Эрх 09-21-нд дуусна» = локал өдрийн 23:59:59
 *   • «Өнөөдрийн ирц» = локал өдрийн 00:00-аас
 *   • Сануулга 09:00-д = локал цагаар
 *
 * Гуравдагч сан (date-fns-tz г.м.) нэмэхийн оронд `Intl`-ээр тооцно —
 * DST-гүй бүсэд (Монгол) найдвартай, хамаарал нэмэхгүй.
 */

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}

/** Өгсөн агшныг заасан бүсэд задалж он/сар/өдөр/цаг авна. */
export function localParts(date: Date, tz: string): Parts {
  const p = formatter(tz).formatToParts(date);
  const get = (t: string): number => Number(p.find((x) => x.type === t)?.value);
  // `hour: '2-digit'` + `hour12: false` нь шөнө дунд 24 гэж өгч болно.
  const h = get('hour');
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: h === 24 ? 0 : h,
    mi: get('minute'),
    s: get('second'),
  };
}

/** Тухайн агшинд бүсийн UTC-ээс хазайлт (мс). */
function tzOffsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Локал он/сар/өдөр/цагаас жинхэнэ UTC агшин үүсгэнэ. */
function fromLocal(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  ms: number,
  tz: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, s, ms);
  // Хазайлтыг таамаглалын агшин дээр тооцоод залруулна. DST-гүй бүсэд нэг
  // дамжлага хангалттай; DST-тэй бүсэд ч ирмэгийн 1 цагаас бусад нь зөв.
  const off = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - off);
}

/** `YYYY-MM-DD` — локал өдрийн түлхүүр (тайлан бүлэглэхэд). */
export function localDateKey(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Локал өдрийн эхлэл (00:00:00.000). */
export function startOfLocalDay(date: Date, tz: string): Date {
  const p = localParts(date, tz);
  return fromLocal(p.y, p.m, p.d, 0, 0, 0, 0, tz);
}

/** Локал өдрийн төгсгөл (23:59:59.999). */
export function endOfLocalDay(date: Date, tz: string): Date {
  const p = localParts(date, tz);
  return fromLocal(p.y, p.m, p.d, 23, 59, 59, 999, tz);
}

/** Локал цагийн тодорхой цагийг авах (сануулга 09:00 гэх мэт). */
export function localTimeOfDay(date: Date, hour: number, tz: string): Date {
  const p = localParts(date, tz);
  return fromLocal(p.y, p.m, p.d, hour, 0, 0, 0, tz);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Хоёр агшны хооронд хэдэн ЛОКАЛ өдөр байгаа (тэмдэгтэй). */
export function daysBetween(from: Date, to: Date, tz: string): number {
  const a = startOfLocalDay(from, tz).getTime();
  const b = startOfLocalDay(to, tz).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * ★ Сунгалтын шинэ дуусах огноог тооцно — БҮХ сунгалтын ганц дүрэм
 * (docs/05-backend-api.md §4.1).
 *
 *   base = (одоогийн эрх хүчинтэй бол) одоогийн дуусах огноо
 *          (эсвэл)                     одоо
 *   шинэ = base + хоног, локал өдрийн 23:59:59-д тэгшилнэ
 *
 * Ингэснээр эрт төлсөн хүний үлдсэн хоног АЛДАГДАХГҮЙ.
 */
export function computeNewEndsAt(
  currentEndsAt: Date | null,
  days: number,
  now: Date,
  tz: string,
): Date {
  const base =
    currentEndsAt && currentEndsAt.getTime() > now.getTime()
      ? currentEndsAt
      : now;
  return endOfLocalDay(addDays(base, days), tz);
}
