/**
 * Ангийн ОРОЛТЫН ӨДРҮҮДИЙГ тооцоолно.
 *
 * ★ ЯАГААД ХАДГАЛАХГҮЙ, ТООЦООЛОХ ВЭ
 *
 * Хичээлийн өдрүүд нь (эхлэх, дуусах, гарагууд) гурвын үр дүн.
 * Мөр болгож хадгалбал ангийн хуваарь өөрчлөгдөхөд тэдгээрийг дахин
 * үүсгэх шаардлагатай болж, ирцтэй өдрүүд эзэнгүй үлдэнэ.
 *
 * ★ ЯАГААД `Date` БИШ, ТЕКСТ ВЭ
 *
 * `YYYY-MM-DD` нь цагийн бүсгүй. `Date` ашиглавал сервер UTC дээр
 * ажиллаж байхад «9-р сарын 25» нь 24-ний 16:00 болж, Улаанбаатарын
 * хэрэглэгчид өдөр нь НЭГЭЭР гулсаж харагдана. Энэ алдаа нь нэг өдөр
 * илүү/дутуу хичээл үүсгэдэг тул шууд мөнгөнд нөлөөлнө.
 *
 * ⚠ Тооцооллыг UTC-гийн ҮД дээр хийнэ (`T12:00:00Z`). Шөнө дундаар
 * хийвэл зуны цаг эсвэл бүсийн шилжилттэй улсад өдөр нааш цааш
 * үсэрдэг.
 */

/** Хамгийн олон оролт — хэт урт анги сервер, дэлгэцийг дүүргэхээс. */
export const MAX_SESSIONS = 400;

export interface CourseSchedule {
  /** `YYYY-MM-DD` */
  startsOn: string;
  /** `YYYY-MM-DD` */
  endsOn: string;
  /** 0 = Ням … 6 = Бямба (JS `getDay()`-тай ижил). */
  weekdays: number[];
}

/** `2026-09-25` → UTC-гийн үд. */
function noon(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

/** UTC мөчийг `YYYY-MM-DD` болгоно. */
function key(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Ангийн бүх оролтын өдрийг өсөх дарааллаар.
 *
 * Гарагийн жагсаалт хоосон бол хоосон — «ямар ч өдөр» гэсэн утга
 * ҮГҮЙ. Хоосон хуваарийг «өдөр бүр» гэж тайлбарлавал ажилтан
 * гарагаа сонгохоо мартаад 30 хичээлтэй анги үүсгэнэ.
 */
export function courseSessions(c: CourseSchedule): string[] {
  const days = new Set(c.weekdays.filter((d) => d >= 0 && d <= 6));
  if (!days.size) return [];

  const from = noon(c.startsOn);
  const to = noon(c.endsOn);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return [];

  const out: string[] = [];
  for (let t = from; t <= to && out.length < MAX_SESSIONS; t += 86_400_000) {
    if (days.has(new Date(t).getUTCDay())) out.push(key(t));
  }
  return out;
}

/** Нийт оролтын тоо — жагсаалт барихгүйгээр. */
export function countSessions(c: CourseSchedule): number {
  return courseSessions(c).length;
}

/**
 * Өнөөдөр эсвэл түүнээс хойшхи ХАМГИЙН ОЙРЫН оролт.
 *
 * `null` = анги дууссан. Дэлгэц дээр «Одоо орох анги» гэж харуулахад.
 */
export function nextSession(c: CourseSchedule, today: string): string | null {
  return courseSessions(c).find((d) => d >= today) ?? null;
}

/**
 * Ангийн төлөв — жагсаалтын шүүлтүүрт.
 *
 * ⚠ `archived` нь ЭНД биш, дуудагч талд шийдэгдэнэ: тэр нь хуваарийн
 * биш, гараар тавьсан тэмдэг.
 */
export type CourseState = 'upcoming' | 'active' | 'finished';

export function courseState(c: CourseSchedule, today: string): CourseState {
  if (today < c.startsOn) return 'upcoming';
  if (today > c.endsOn) return 'finished';
  return 'active';
}

/** Өнөөдөр ЗААСАН бүсээр — `YYYY-MM-DD`. */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
