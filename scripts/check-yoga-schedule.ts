import {
  courseSessions,
  courseState,
  MAX_SESSIONS,
  nextSession,
} from '../src/modules/yoga/yoga.schedule';

/**
 * Ангийн оролтын өдрүүдийг шалгана.
 *
 * ★ ЯАГААД ТУСДАА ШАЛГАЛТ ВЭ
 *
 * Энэ тооцоолол БУРУУ байвал шууд мөнгөнд нөлөөлнө: нэг өдөр илүү
 * эсвэл дутуу хичээл гарч, гишүүн «би 12 удаа орох ёстой байсан»
 * гэж маргана. Алдаа нь чимээгүй — хуанли дүүрэн харагдсаар байна.
 *
 * ⚠ Хамгийн эмзэг нь ЦАГИЙН БҮС. Сервер UTC дээр ажилладаг ч заал
 * Улаанбаатарт (+08). Тооцооллыг шөнө дундаар хийвэл өдөр нь нэгээр
 * гулсана.
 */

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
function ok(name: string, cond: boolean, got?: unknown): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    fails++;
    console.log(`✗ ${name}${got === undefined ? '' : `\n   got: ${String(got)}`}`);
  }
}

// 2026-09-25 бол БААСАН гараг (getDay() = 5).
const C = (startsOn: string, endsOn: string, weekdays: number[]) => ({
  startsOn,
  endsOn,
  weekdays,
});

// ── Үндсэн ──

eq(
  'нэг гараг (Баасан), 3 долоо хоног',
  courseSessions(C('2026-09-25', '2026-10-09', [5])),
  ['2026-09-25', '2026-10-02', '2026-10-09'],
);

eq(
  'Дав/Лха/Баа — нэг долоо хоног',
  courseSessions(C('2026-09-21', '2026-09-27', [1, 3, 5])),
  ['2026-09-21', '2026-09-23', '2026-09-25'],
);

eq(
  'эхлэх өдөр нь гарагт таарахгүй бол алгасна',
  courseSessions(C('2026-09-22', '2026-09-28', [1])),
  ['2026-09-28'],
);

eq(
  'дуусах өдөр нь БАГТАНА',
  courseSessions(C('2026-09-25', '2026-09-25', [5])),
  ['2026-09-25'],
);

eq(
  'нэг өдрийн анги, гараг таарахгүй',
  courseSessions(C('2026-09-25', '2026-09-25', [1])),
  [],
);

/*
 * ⚠ Гараг сонгоогүй бол ХООСОН. «Өдөр бүр» гэж тайлбарлавал ажилтан
 * гарагаа сонгохоо мартаад 30 хичээлтэй анги үүсгэнэ.
 */
eq('гараггүй → хоосон', courseSessions(C('2026-09-01', '2026-09-30', [])), []);

eq(
  'буруу дараалал (дуусах < эхлэх) → хоосон',
  courseSessions(C('2026-10-01', '2026-09-01', [1])),
  [],
);

eq(
  'муу огноо → хоосон',
  courseSessions(C('оршихгүй', '2026-09-30', [1])),
  [],
);

// ── Цагийн бүс ──

/*
 * ★ ХАМГИЙН ЧУХАЛ ШАЛГАЛТ
 *
 * Сервер UTC дээр ажилладаг. Хэрэв тооцооллыг шөнө дундаар хийвэл
 * «2026-09-25» нь орон нутгийн 24-ний орой болж, гараг НЭГЭЭР
 * гулсана. Үд дээр тооцсоноор энэ гулсалт үүсэхгүй.
 */
{
  const saved = process.env.TZ;
  const results: Record<string, string[]> = {};
  for (const tz of ['UTC', 'Asia/Ulaanbaatar', 'America/Los_Angeles']) {
    process.env.TZ = tz;
    results[tz] = courseSessions(C('2026-09-25', '2026-10-09', [5]));
  }
  process.env.TZ = saved;
  ok(
    'бүсээс ҮЛ ХАМААРНА',
    JSON.stringify(results['UTC']) ===
      JSON.stringify(results['Asia/Ulaanbaatar']) &&
      JSON.stringify(results['UTC']) ===
        JSON.stringify(results['America/Los_Angeles']),
    JSON.stringify(results),
  );
}

// ── Сарын зааг, өндөр жил ──

eq(
  'сарын зааг давна',
  courseSessions(C('2026-09-28', '2026-10-05', [1])),
  ['2026-09-28', '2026-10-05'],
);

eq(
  'өндөр жилийн 2-р сар (2028)',
  courseSessions(C('2028-02-26', '2028-03-04', [2])),
  ['2028-02-29'],
);

// ── Хязгаар ──

ok(
  `хэт урт анги ${MAX_SESSIONS}-аар таслагдана`,
  courseSessions(C('2020-01-01', '2030-01-01', [0, 1, 2, 3, 4, 5, 6])).length ===
    MAX_SESSIONS,
  courseSessions(C('2020-01-01', '2030-01-01', [0, 1, 2, 3, 4, 5, 6])).length,
);

ok(
  'мужаас гадуурх гараг алгасагдана',
  courseSessions(C('2026-09-21', '2026-09-27', [1, 9, -3])).length === 1,
);

// ── Дараагийн оролт ──

eq(
  'өнөөдөр оролттой бол ӨНӨӨДӨР',
  nextSession(C('2026-09-25', '2026-10-09', [5]), '2026-10-02'),
  '2026-10-02',
);
eq(
  'өнөөдөр оролтгүй бол дараагийнх',
  nextSession(C('2026-09-25', '2026-10-09', [5]), '2026-09-28'),
  '2026-10-02',
);
eq(
  'анги дууссан бол null',
  nextSession(C('2026-09-25', '2026-10-09', [5]), '2026-11-01'),
  null,
);

// ── Төлөв ──

eq('эхлээгүй', courseState(C('2026-10-01', '2026-10-31', [1]), '2026-09-24'), 'upcoming');
eq('явагдаж буй', courseState(C('2026-09-01', '2026-10-31', [1]), '2026-09-24'), 'active');
eq('дууссан', courseState(C('2026-08-01', '2026-08-31', [1]), '2026-09-24'), 'finished');
eq(
  'эхлэх өдөр нь ЯВАГДАЖ БУЙ',
  courseState(C('2026-09-24', '2026-10-31', [1]), '2026-09-24'),
  'active',
);
eq(
  'дуусах өдөр нь ЯВАГДАЖ БУЙ',
  courseState(C('2026-09-01', '2026-09-24', [1]), '2026-09-24'),
  'active',
);

console.log(fails ? `\n${fails} шалгалт унав` : '\nБүгд тэнцэв');
process.exit(fails ? 1 : 0);
