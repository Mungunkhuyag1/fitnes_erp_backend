import {
  clampDeviceDate,
  deviceValidity,
  syncPlan,
  TOPIC,
} from '../src/common/utils/sync-plan.util';
import { MemberStatus } from '../src/common/enums/member-status.enum';

/**
 * Терминал руу бичигдэх эрхийн хугацааг шалгана.
 *
 * ★ ЯАГААД ТУСДАА ШАЛГАЛТ ВЭ
 *
 * Энэ дүрэм УНАВАЛ чимээгүй: гишүүн WinFit дээр «идэвхтэй» харагдах
 * ч терминал хуучин утгаараа үлдэнэ. Хүн маргааш хаалган дээр
 * зогсож байж мэдэгдэнэ.
 *
 * Бодит газар дээр яг ингэж эвдэрсэн: 10 жилийн эрхтэй ажилтан
 * (№91991499) дээр НЭГ хоног нэмэхэд 2038-01-01 болж,
 *
 *     statusCode 6 · Invalid Content · badJsonContent · errorMsg: endTime
 *
 * гэж бүрмөсөн унасан.
 */

let fails = 0;
function ok(name: string, cond: boolean, got?: unknown): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    fails++;
    console.log(`✗ ${name}${got === undefined ? '' : `\n   got: ${String(got)}`}`);
  }
}

/** Терминал руу ЯГ ямар мөр явахыг дуурайлгана (UB орон нутгийн цаг). */
function asTerminal(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string): string => p.find((x) => x.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`;
}

const member = (accessEndsAt: string | null, createdAt = '2026-09-01T00:00:00Z') => ({
  name: 'Mmm',
  memberNo: '91991499',
  status: MemberStatus.ACTIVE,
  accessEndsAt,
  createdAt,
});

// ── Хязгаарын цөм ──

ok(
  'хэвийн огноо ХЭВЭЭР',
  clampDeviceDate(new Date('2026-10-23T15:59:59.999Z')).toISOString() ===
    '2026-10-23T15:59:59.999Z',
);

ok(
  '2038-01-01 → хязгаарт татагдана',
  clampDeviceDate(new Date('2038-01-01T15:59:59.999Z')).getTime() <
    new Date('2038-01-01T00:00:00Z').getTime(),
  clampDeviceDate(new Date('2038-01-01T15:59:59.999Z')).toISOString(),
);

ok(
  '1999 огноо → дээш татагдана',
  clampDeviceDate(new Date('1999-12-31T00:00:00Z')).getTime() >=
    Date.UTC(2000, 0, 1),
);

ok(
  'буруу огноо унахгүй',
  !Number.isNaN(clampDeviceDate(new Date('оршихгүй')).getTime()),
);

/*
 * ★ ХАМГИЙН ЧУХАЛ ШАЛГАЛТ — ТЕРМИНАЛ РУУ ЯВАХ МӨР.
 *
 * Хязгаарыг UTC-гээр тавьсан ч бичигдэхдээ ОРОН НУТГИЙН цаг (+08)
 * болдог. `23:59:59Z` гэж тавибал UB дээр 2038-01-01 болж ДАХИН
 * унана — тиймээс эцсийн мөрийг нь шалгана, зөвхөн Date объектыг биш.
 */
const written = asTerminal(clampDeviceDate(new Date('2038-06-01T00:00:00Z')));
ok(
  `терминал руу бичигдэх мөр 2038 болохгүй (${written})`,
  written < '2038-01-01',
  written,
);
ok(
  `хязгаар 2037 он дотор (${written})`,
  written.startsWith('2037-12-'),
  written,
);

// ── Бодит тохиолдол: №91991499 ──

const v = deviceValidity(member('2038-01-01T15:59:59.999Z'));
ok(
  'бодит гишүүний дуусах огноо хязгаарлагдав',
  asTerminal(v.end) < '2038-01-01',
  asTerminal(v.end),
);

/*
 * ⚠ ТУЛГАЛТ МӨНХИЙН ЗӨРҮҮ ЗААХ ЁСГҮЙ.
 *
 * Хязгаарыг ISAPI клиент дотор тавьсан бол WinFit «2038-01-01» гэж
 * үзсээр байх ба терминал 2037-12-31 гэж хадгалах — тулгалт тэр
 * гишүүнийг ҮҮРД «зөрүүтэй» гэж заана. Төлөвлөгөө нь `deviceValidity`
 * -г дууддаг тул хоёулаа ижил утга харуулах ёстой.
 */
const plan = syncPlan(TOPIC.HIK_UPSERT, member('2038-01-01T15:59:59.999Z'));
const planEnd = plan.find((p) => p.label === 'Дуусах огноо')?.value ?? '';
ok(
  `төлөвлөгөө нь ХЯЗГААРЛАСАН огноог харуулна (${planEnd})`,
  planEnd.startsWith('2037-'),
  planEnd,
);

// ── Хэвийн гишүүд хөндөгдөхгүй ──

const normal = deviceValidity(member('2026-10-23T15:59:59.999Z'));
ok(
  'хэвийн гишүүний огноо хөндөгдөөгүй',
  normal.end.toISOString() === '2026-10-23T15:59:59.999Z',
  normal.end.toISOString(),
);

ok(
  'эрхгүй гишүүнд `createdAt` ашиглана',
  deviceValidity(member(null, '2026-09-01T00:00:00Z')).end.toISOString() ===
    '2026-09-01T00:00:00.000Z',
);

// ── ХААЛТ: огноогоор, `enable`-ээр БИШ ──

/*
 * ★ ХАМГИЙН ЭМЗЭГ ХЭСЭГ
 *
 * Hikvision-ий `Valid.enable` нь «хэрэглэгч идэвхтэй юу» БИШ,
 * «хүчинтэй ХУГАЦААГ шалгах уу» гэсэн утгатай. `false` бичвэл
 * хугацааны шалгалт УНТАРЧ, цуцалсан гишүүн ХЯЗГААРГҮЙ нэвтрэх
 * боломжтой болно — хаах гэсэн үйлдэл эсрэгээрээ нээнэ.
 *
 * Бодит терминал дээр 339 хэрэглэгч БҮГД `enable = true`, тэр дундаа
 * хугацаа нь өнгөрсөн 245 хүн ч мөн адил. Заал хаалтыг ОГНООГООР
 * хийдэг ба тэр нь ажилладаг нь батлагдсан.
 */
for (const st of [MemberStatus.SUSPENDED, MemberStatus.CANCELLED] as const) {
  const blockedV = deviceValidity({
    ...member('2027-10-23T00:00:00Z'), // ⚠ ИРЭЭДҮЙН огноо
    status: st,
  });
  ok(`${st}: enable нь ҮРГЭЛЖ true`, blockedV.enable === true, blockedV.enable);
  ok(
    `${st}: хугацаа ТЭГ урт (эхлэл = төгсгөл)`,
    blockedV.end.getTime() === blockedV.begin.getTime(),
    `${blockedV.begin.toISOString()} → ${blockedV.end.toISOString()}`,
  );
  ok(
    `${st}: төгсгөл нь ӨНГӨРСӨН — нэвтрэх боломжгүй`,
    blockedV.end.getTime() < Date.now(),
    blockedV.end.toISOString(),
  );
  /*
   * ⚠ Ирээдүйн `accessEndsAt`-ыг ашиглаж БОЛОХГҮЙ. Түр зогсоолт нь
   * огноог хөндөхгүй тул тэр нь 2027 онд дуусна — хаалт үүнийг
   * дагавал гишүүн жилийн турш нэвтэрсээр байна.
   */
  ok(
    `${st}: ирээдүйн accessEndsAt-ыг АШИГЛАХГҮЙ`,
    blockedV.end.getFullYear() < 2027,
    blockedV.end.toISOString(),
  );
}

// Хугацаа дууссан нь ХААГДСАН биш — огноо нь өөрөө хаана.
const expiredV = deviceValidity({
  ...member('2026-01-01T00:00:00Z'),
  status: MemberStatus.EXPIRED,
});
ok(
  'expired: жинхэнэ дуусах огноогоо хадгална',
  expiredV.end.toISOString() === '2026-01-01T00:00:00.000Z',
  expiredV.end.toISOString(),
);
ok('expired: enable true', expiredV.enable === true);

ok(
  'идэвхтэй гишүүн хөндөгдөхгүй',
  deviceValidity(member('2026-10-23T15:59:59.999Z')).end.toISOString() ===
    '2026-10-23T15:59:59.999Z',
);

console.log(fails ? `\n${fails} шалгалт унав` : '\nБүгд тэнцэв');
process.exit(fails ? 1 : 0);
