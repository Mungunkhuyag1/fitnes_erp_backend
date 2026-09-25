/**
 * Хуваарь ба «заал хаалттай цаг»-ийн логикийг шалгана.
 *
 * ★ ЯАГААД ТУСДАА ШАЛГАЛТ ВЭ
 *
 * Хоёр чимээгүй алдаа энд л баригдана:
 *
 *  1. ЦАГИЙН БҮС. Railway UTC дээр ажиллана, заал Улаанбаатарт (+08).
 *     `new Date().getHours()` бичвэл 8 цагаар зөрнө: UTC 15:00 нь UB
 *     23:00 — өөрөөр хэлбэл «завсарлага» гэж бодсон цаг нь өдрийн
 *     хамгийн ачаалалтай үед таарна.
 *
 *  2. ШӨНӨ ДУНДЫГ ДАВАХ МУЖ. 22 → 7 гэсэн муж нь `from <= h && h < to`
 *     гэж бичвэл ХЭЗЭЭ Ч үнэн болохгүй. Тэр алдаа нь «мэйл хаагдсан»
 *     гэж бодуулаад өдөр бүр 60 мэйл явуулсаар байна.
 *
 * ⚠ `inQuietHours` нь модуль ачаалагдах үед `process.env`-ээс уншсан
 * тогтмолуудыг хэрэглэдэг тул ЭНД env-ийг ӨМНӨ нь тавина.
 */
process.env.DEVICE_QUIET_FROM ??= '22';
process.env.DEVICE_QUIET_TO ??= '7';

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  CRON,
  QUIET_FROM_HOUR,
  QUIET_TO_HOUR,
  hourIn,
  inQuietHours,
} = require('../src/config/schedule') as typeof import('../src/config/schedule');

let fails = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) console.log(`✓ ${name}`);
  else {
    fails++;
    console.log(`✗ ${name}\n   got  ${a}\n   want ${b}`);
  }
}

const UB = 'Asia/Ulaanbaatar';

/** UTC-ийн цагаас Date — UB нь +08 тул 8 цаг нэмэгдэнэ. */
const utc = (h: number, m = 0): Date =>
  new Date(Date.UTC(2026, 8, 25, h, m, 0));

// ══════════════════════════════════════════════════════════════
//  hourIn — цагийн бүс
// ══════════════════════════════════════════════════════════════

eq('UTC 00:00 → UB 08 цаг', hourIn(UB, utc(0)), 8);
eq('UTC 15:00 → UB 23 цаг', hourIn(UB, utc(15)), 23);
// ⚠ Хамгийн эмзэг мөч: UB-ийн шөнө дунд. `hour12: false` нь энд «24»
// буцааж мэдэх тул `hourCycle: 'h23'` заавал хэрэгтэй.
eq('UTC 16:00 → UB 0 цаг (24 БИШ)', hourIn(UB, utc(16)), 0);
eq('UTC 16:59 → UB 0 цаг', hourIn(UB, utc(16, 59)), 0);
eq('UTC 17:00 → UB 1 цаг', hourIn(UB, utc(17)), 1);
eq('UTC 23:00 → UB 7 цаг', hourIn(UB, utc(23)), 7);

// ══════════════════════════════════════════════════════════════
//  inQuietHours — шөнө дундыг давсан муж (22 → 7)
// ══════════════════════════════════════════════════════════════

eq('тогтмол уншигдав', [QUIET_FROM_HOUR, QUIET_TO_HOUR], [22, 7]);

// Заал ОРОЙ хаагдана
eq('UB 21:00 — заал нээлттэй', inQuietHours(UB, utc(13)), false);
eq('UB 22:00 — завсарлага НЭЭГДЭНЭ', inQuietHours(UB, utc(14)), true);
eq('UB 23:30 — завсарлага', inQuietHours(UB, utc(15, 30)), true);

// Шөнө дундыг давна
eq('UB 00:00 — завсарлага', inQuietHours(UB, utc(16)), true);
eq('UB 03:06 — завсарлага (outbox үүрд унтардаг мөч)', inQuietHours(UB, utc(19, 6)), true);
eq('UB 06:59 — завсарлага', inQuietHours(UB, utc(22, 59)), true);

// Заал НЭЭГДЭНЭ — 07:00-ийн cron-ууд мэйл хаагдаагүй үед ажиллана
eq('UB 07:00 — завсарлага ДУУСНА', inQuietHours(UB, utc(23)), false);
eq('UB 07:30 — нээлттэй', inQuietHours(UB, utc(23, 30)), false);
eq('UB 12:00 — нээлттэй', inQuietHours(UB, utc(4)), false);

// ══════════════════════════════════════════════════════════════
//  Хуваарийн ДАРААЛАЛ
// ══════════════════════════════════════════════════════════════

/** `'30 7 * * *'` → 7 * 60 + 30 = минут. */
function minutes(cron: string): number {
  const [m, h] = cron.split(' ');
  return Number(h) * 60 + Number(m);
}

const audit = minutes(CRON.DEVICE_AUDIT);
const reconcile = minutes(CRON.DEVICE_RECONCILE);
const reminders = minutes(CRON.SEND_REMINDERS);

// ⚠ Туннелээс хамаарах ажил заал НЭЭГДСЭН хойно ажиллах ЁСТОЙ.
eq('тулгалт заал нээгдсэн хойно', audit >= QUIET_TO_HOUR * 60, true);
eq('нөхөлт заал нээгдсэн хойно', reconcile >= QUIET_TO_HOUR * 60, true);

// Тулгалт зөрүүг дараалалд оруулна, нөхөлт үлдэгдлийг засна.
eq('тулгалт < нөхөлт', audit < reconcile, true);
// Сануулга нь зассаны ДАРАА явна — эс бөгөөс буруу огноо мэйлдэнэ.
eq('нөхөлт < сануулга', reconcile < reminders, true);

console.log(fails ? `\n${fails} шалгалт унав` : '\nБүх шалгалт OK');
process.exit(fails ? 1 : 0);
