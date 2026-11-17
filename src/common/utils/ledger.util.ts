import { addDays, endOfLocalDay } from './date.util';

/**
 * ★ Гишүүнчлэлийн дэвтрийг «тоглуулах» ДҮРЭМ — хоног ба оролт хоёуланд.
 *
 * Энэ файл юунаас ч хамаарахгүй (DB, Nest) тул `membership` ба `access`
 * модуль хоёулаа ДАВХАР ГОГЦООгүйгээр ашиглана, `check:entries` скрипт
 * шууд шалгана.
 *
 * ★ ДҮРЭМ
 *
 *  1. Мөрүүд худалдан авсан дарааллаараа ХЭРЭГЛЭГДЭНЭ. Мөр бүр өмнөхийнхөө
 *     төгсгөлөөс (эсвэл худалдан авсан агшнаас, аль нь хожуу) эхэлнэ.
 *  2. Хоногийн мөр (`entries = null`) — `days` хоног хязгааргүй.
 *  3. Оролтын мөр (`entries = N`) — `days` хоног ЭСВЭЛ оролт дуусах хүртэл.
 *     Оролт дуусвал `closedAt` тогтоогдож, дараагийн мөр ТЭР агшнаас эхэлнэ.
 *  4. `joinsPrevious` мөр нь шинэ цонх нээхгүй — өмнөх ОРОЛТЫН бүлгийн
 *     хоног, оролтыг нэмэгдүүлнэ (чөлөө, гараар нэмсэн оролт).
 *
 * Бүлэг = тэргүүн мөр + түүнд нэгдсэн мөрүүд. Хасалт ба `closedAt` нь
 * ЗӨВХӨН тэргүүн мөр дээр.
 */

export interface LedgerRow {
  id: string;
  createdAt: Date;
  startsAt?: Date;
  days: number;
  entries: number | null;
  entriesUsed: number;
  joinsPrevious: boolean;
  closedAt: Date | null;
}

export interface LedgerSegment {
  /** Тэргүүн мөр — хасалт, `closedAt` энд. */
  headId: string;
  rowIds: string[];
  start: Date;
  /** Хаагдаагүй байсан бол дуусах байсан огноо. */
  naturalEnd: Date;
  /** Бодит төгсгөл: `min(naturalEnd, closedAt)`. */
  end: Date;
  days: number;
  /** `null` = хязгааргүй (хоногийн бүлэг). */
  entries: number | null;
  used: number;
  closedAt: Date | null;
}

/**
 * Дэвтрийг тоглуулж бүлгүүдийг гаргана.
 *
 * @param rows   БУЦААГДААГҮЙ мөрүүд, `createdAt`-аар өсөхөөр эрэмбэлсэн
 * @param first  Эхний бүлгийн эхлэлийг ХҮЧЭЭР тогтоох (хадгалсан `startsAt`).
 *               Терминалаас импортолсон эрх дэвтэрт мөргүй байдаг тул эхний
 *               мөрийн хадгалсан эхлэл нь тэр суурийг агуулна.
 */
export function replayLedger(
  rows: LedgerRow[],
  tz: string,
  first?: Date | null,
): LedgerSegment[] {
  const segs: LedgerSegment[] = [];
  let prevEnd: Date | null = null;

  for (const r of rows) {
    const last = segs[segs.length - 1];
    if (r.joinsPrevious && last && last.entries !== null) {
      last.rowIds.push(r.id);
      last.days += r.days;
      last.entries += r.entries ?? 0;
      last.naturalEnd = endOfLocalDay(addDays(last.start, last.days), tz);
      last.end = clamp(last.naturalEnd, last.closedAt);
      prevEnd = last.end;
      continue;
    }

    let start: Date =
      !segs.length && first
        ? first
        : prevEnd && prevEnd > r.createdAt
          ? prevEnd
          : r.createdAt;
    /*
     * ★ ХАДГАЛСАН ЭХЛЭЛ ЭРТ БАЙВАЛ ТЭР ЯЛНА — өмнөх бүлгийг тасална.
     *
     * Цуцлалт нь `accessEndsAt`-ыг өнөөдрөөр хаадаг ч дэвтрийн мөрийг
     * хөндөхгүй. Дараа нь сэргээж сунгахад шинэ мөр ОДООгоос эхэлсэн
     * боловч тоглуулалт хуучин мөрийн байгалийн төгсгөлөөс эхлүүлж,
     * оролтын багц хуучин хязгааргүй цонхны ард «нуугдана».
     */
    if (r.startsAt && last && r.startsAt < start && r.startsAt >= r.createdAt) {
      start = r.startsAt;
      if (last.end > start) last.end = start;
    }
    const naturalEnd = endOfLocalDay(addDays(start, r.days), tz);
    const seg: LedgerSegment = {
      headId: r.id,
      rowIds: [r.id],
      start,
      naturalEnd,
      end: clamp(naturalEnd, r.entries !== null ? r.closedAt : null),
      days: r.days,
      entries: r.entries,
      used: r.entries !== null ? r.entriesUsed : 0,
      closedAt: r.entries !== null ? r.closedAt : null,
    };
    segs.push(seg);
    prevEnd = seg.end;
  }
  return segs;
}

/** `t` агшинд идэвхтэй бүлэг (байхгүй бол `null`). */
export function segmentAt(
  segs: LedgerSegment[],
  t: Date,
): LedgerSegment | null {
  const x = t.getTime();
  return (
    segs.find((s) => s.start.getTime() <= x && x <= s.end.getTime()) ?? null
  );
}

/** Гишүүнд харуулах оролтын төлөв — хоногийн эрхтэй бол `null`. */
export interface EntryStatus {
  total: number;
  used: number;
  left: number;
  /** Энэ оролтын бүлэг хэзээ хүртэл хүчинтэй (оролт үлдсэн ч). */
  validUntil: Date;
}

export function entryStatusAt(
  segs: LedgerSegment[],
  t: Date,
): EntryStatus | null {
  const s = segmentAt(segs, t);
  if (!s || s.entries === null) return null;
  return {
    total: s.entries,
    used: s.used,
    left: Math.max(0, s.entries - s.used),
    validUntil: s.end,
  };
}

/** Хасалтын горим — тохиргооны `entry_charge_mode`. */
export type EntryChargeMode = 'every' | 'window' | 'day';

/**
 * Уншуулалт ДАВХАРДАЛ гэж тооцогдох хамгийн бага зай.
 *
 * ⚠ «Уншуулалт бүр» горимд ч хэрэгтэй: терминал нэг ирэлт дээр хоёр
 * эвент (minor 75 ба 104) илгээдэг ба секундын зааг дээр давхардлын
 * түлхүүр нь хоёр өөр болж болно. Шал байхгүй бол нэг ирэлт ХОЁР
 * оролт иднэ.
 */
export const ENTRY_DEDUPE_FLOOR_MS = 60_000;

function clamp(end: Date, closedAt: Date | null): Date {
  return closedAt && closedAt < end ? closedAt : end;
}
