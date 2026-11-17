/**
 * Оролтын багцын дэвтрийн дүрмийг (`ledger.util.ts`) шалгана.
 *
 * ★ ЯАГААД ТУСДАА ШАЛГАЛТ ВЭ
 *
 * Энэ дүрэм нь терминал дээрх ДУУСАХ ОГНООГ шийддэг. Алдаа гарвал хоёр
 * чимээгүй үр дагавартай:
 *
 *  1. Оролт дууссан бүлэг хаагдсан ч дараагийн багц эрт эхлэхгүй →
 *     гишүүн төлсөн хоногоо алдана.
 *  2. Чөлөөний хоног оролтын бүлэгт нэгдэхгүй, хязгааргүй цонх болно →
 *     оролтын гишүүн үнэгүй хязгааргүй эрх авна.
 */
import {
  entryStatusAt,
  replayLedger,
  segmentAt,
  type LedgerRow,
} from '../src/common/utils/ledger.util';

const TZ = 'Asia/Ulaanbaatar';
let failed = 0;

function eq(label: string, got: unknown, want: unknown): void {
  const g = got instanceof Date ? got.toISOString() : JSON.stringify(got);
  const w = want instanceof Date ? want.toISOString() : JSON.stringify(want);
  if (g === w) {
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}\n      хүлээсэн: ${w}\n      гарсан:   ${g}`);
  }
}

const d = (s: string) => new Date(s);
const row = (p: Partial<LedgerRow> & { id: string; createdAt: Date; days: number }): LedgerRow => ({
  entries: null,
  entriesUsed: 0,
  joinsPrevious: false,
  closedAt: null,
  ...p,
});

// ── 1. Хоногийн мөрүүд — хуучин дүрэмтэй ижил ──
console.log('1. Хоногийн мөрүүд дараална');
{
  const segs = replayLedger(
    [
      row({ id: 'a', createdAt: d('2026-11-01T02:00:00Z'), days: 30 }),
      row({ id: 'b', createdAt: d('2026-11-10T02:00:00Z'), days: 30 }),
    ],
    TZ,
  );
  // 11-01 +30 = 12-01 23:59:59 (UB) = 12-01T15:59:59.999Z
  eq('эхний төгсгөл', segs[0].end, d('2026-12-01T15:59:59.999Z'));
  eq('хоёр дахь нь эхнийхийн төгсгөлөөс', segs[1].start, segs[0].end);
  eq('хязгааргүй', segs[1].entries, null);
}

// ── 2. Оролт дуусвал дараагийн багц ЭРТ эхэлнэ ──
console.log('2. Хаагдсан оролтын бүлэг');
{
  const closed = d('2026-11-20T05:00:00Z');
  const segs = replayLedger(
    [
      row({ id: 'e', createdAt: d('2026-11-01T02:00:00Z'), days: 60, entries: 12, entriesUsed: 12, closedAt: closed }),
      row({ id: 'p', createdAt: d('2026-11-05T02:00:00Z'), days: 30 }),
    ],
    TZ,
  );
  eq('бүлгийн төгсгөл = closedAt', segs[0].end, closed);
  eq('дараагийн багц closedAt-аас', segs[1].start, closed);
}

// ── 3. Нэгдэх мөр (чөлөө) — шинэ цонх нээхгүй ──
console.log('3. Чөлөө оролтын бүлэгт нэгдэнэ');
{
  const rows = [
    row({ id: 'e', createdAt: d('2026-11-01T02:00:00Z'), days: 60, entries: 12, entriesUsed: 3 }),
    row({ id: 'f', createdAt: d('2026-11-15T02:00:00Z'), days: 7, entries: 0, joinsPrevious: true }),
  ];
  const segs = replayLedger(rows, TZ);
  eq('нэг л бүлэг', segs.length, 1);
  eq('хоног нэмэгдэв', segs[0].days, 67);
  eq('оролт хэвээр', segs[0].entries, 12);
  const st = entryStatusAt(segs, d('2026-11-16T02:00:00Z'));
  eq('үлдэгдэл', st && st.left, 9);
}

// ── 4. Нэмэлт оролт нь хаагдсан бүлгийг дахин нээнэ (closedAt = null) ──
console.log('4. Нэмэлт оролт');
{
  const segs = replayLedger(
    [
      row({ id: 'e', createdAt: d('2026-11-01T02:00:00Z'), days: 60, entries: 2, entriesUsed: 2 }),
      row({ id: 'x', createdAt: d('2026-11-03T02:00:00Z'), days: 0, entries: 3, joinsPrevious: true }),
    ],
    TZ,
  );
  eq('нийт оролт', segs[0].entries, 5);
  eq('хоног өөрчлөгдөхгүй', segs[0].days, 60);
}

// ── 5. Импортолсон суурь — эхний мөрийн хадгалсан эхлэл ──
console.log('5. Хадгалсан эхлэлийг хүндэтгэнэ');
{
  const stored = d('2026-12-01T15:59:59.999Z');
  const segs = replayLedger(
    [row({ id: 'e', createdAt: d('2026-11-01T02:00:00Z'), startsAt: stored, days: 60, entries: 10 })],
    TZ,
    stored,
  );
  eq('эхлэл = хадгалсан', segs[0].start, stored);
  eq('өмнө нь хамаарахгүй', segmentAt(segs, d('2026-11-15T00:00:00Z')), null);
}

// ── 6. Хоногийн багцын үед оролтын төлөв байхгүй ──
console.log('6. Хоногийн эрх → төлөв null');
{
  const segs = replayLedger([row({ id: 'a', createdAt: d('2026-11-01T02:00:00Z'), days: 30 })], TZ);
  eq('null', entryStatusAt(segs, d('2026-11-02T00:00:00Z')), null);
}

// ── 7. Цуцлаад сэргээсэн — шинэ мөр хадгалсан эхлэлээсээ ──
console.log('7. Цуцлалтын дараах сэргээлт');
{
  const revivedAt = d('2026-11-10T02:00:00Z');
  const segs = replayLedger(
    [
      row({ id: 'a', createdAt: d('2026-11-01T02:00:00Z'), startsAt: d('2026-11-01T02:00:00Z'), days: 90 }),
      row({ id: 'e', createdAt: revivedAt, startsAt: revivedAt, days: 60, entries: 10 }),
    ],
    TZ,
    d('2026-11-01T02:00:00Z'),
  );
  eq('оролтын багц сэргээсэн агшнаас', segs[1].start, revivedAt);
  eq('хуучин хязгааргүй цонх тасарсан', segs[0].end, revivedAt);
  const st = entryStatusAt(segs, d('2026-11-11T02:00:00Z'));
  eq('оролт тоологдоно', st && st.left, 10);
}

if (failed) {
  console.log(`\n✗ ${failed} шалгалт уналаа`);
  process.exit(1);
}
console.log('\n✓ Бүгд зөв');
