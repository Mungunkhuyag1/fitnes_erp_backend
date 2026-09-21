import { expandRule } from '../src/modules/task/task.expand';
import { TaskKind } from '../src/modules/task/task.entity';

let fails = 0;
function eq(name: string, got: string[], want: string[]) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { fails++; console.log(`✗ ${name}\n   got  ${a}\n   want ${b}`); }
  else console.log(`✓ ${name} (${got.length})`);
}
const R = (kind: TaskKind, startsOn: string, endsOn: string | null = null, active = true) =>
  ({ kind, startsOn, endsOn, active });

// ── НЭГ УДАА ──
eq('once дотор', expandRule(R(TaskKind.ONCE,'2026-09-22'),'2026-09-01','2026-09-30'), ['2026-09-22']);
eq('once гадна', expandRule(R(TaskKind.ONCE,'2026-08-22'),'2026-09-01','2026-09-30'), []);
eq('once ирээдүй', expandRule(R(TaskKind.ONCE,'2026-12-01'),'2026-09-01','2026-09-30'), []);

// ── ӨДӨР БҮР ──
eq('daily 5 хоног', expandRule(R(TaskKind.DAILY,'2026-09-20'),'2026-09-20','2026-09-24'),
   ['2026-09-20','2026-09-21','2026-09-22','2026-09-23','2026-09-24']);
eq('daily эхлэхээс өмнө хасна', expandRule(R(TaskKind.DAILY,'2026-09-22'),'2026-09-20','2026-09-23'),
   ['2026-09-22','2026-09-23']);
eq('daily сар давах', expandRule(R(TaskKind.DAILY,'2026-09-29'),'2026-09-29','2026-10-02'),
   ['2026-09-29','2026-09-30','2026-10-01','2026-10-02']);
eq('daily endsOn хүндэтгэнэ', expandRule(R(TaskKind.DAILY,'2026-09-20','2026-09-22'),'2026-09-20','2026-09-30'),
   ['2026-09-20','2026-09-21','2026-09-22']);
eq('daily идэвхгүй', expandRule(R(TaskKind.DAILY,'2026-09-20',null,false),'2026-09-20','2026-09-30'), []);

// ── 7 ХОНОГ БҮР ── 2026-09-21 бол Даваа
eq('weekly даваа бүр', expandRule(R(TaskKind.WEEKLY,'2026-09-21'),'2026-09-01','2026-10-15'),
   ['2026-09-21','2026-09-28','2026-10-05','2026-10-12']);
eq('weekly эхлэхээс өмнөх муж', expandRule(R(TaskKind.WEEKLY,'2026-09-21'),'2026-09-01','2026-09-20'), []);
eq('weekly дунд мужаас', expandRule(R(TaskKind.WEEKLY,'2026-09-21'),'2026-10-01','2026-10-15'),
   ['2026-10-05','2026-10-12']);

// ── САР БҮР ──
eq('monthly 15-нд', expandRule(R(TaskKind.MONTHLY,'2026-09-15'),'2026-09-01','2026-12-31'),
   ['2026-09-15','2026-10-15','2026-11-15','2026-12-15']);
eq('monthly 31 → сүүлчийн өдөр', expandRule(R(TaskKind.MONTHLY,'2026-01-31'),'2026-01-01','2026-05-01'),
   ['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
eq('monthly 2028 өндөр жил', expandRule(R(TaskKind.MONTHLY,'2028-01-31'),'2028-02-01','2028-03-01'),
   ['2028-02-29']);
eq('monthly жил давах', expandRule(R(TaskKind.MONTHLY,'2026-11-05'),'2026-12-01','2027-02-28'),
   ['2026-12-05','2027-01-05','2027-02-05']);

// ── ХЯЗГААР ──
const wide = expandRule(R(TaskKind.DAILY,'2020-01-01'),'2020-01-01','2030-01-01');
eq('daily хязгаар 400', [String(wide.length)], ['400']);

console.log(fails ? `\n${fails} ШАЛГАЛТ УНАЛАА` : '\nБүгд тэнцлээ');
process.exit(fails ? 1 : 0);
