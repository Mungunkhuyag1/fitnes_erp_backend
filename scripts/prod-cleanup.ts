import { DataSource } from 'typeorm';
import * as fs from 'fs';

/**
 * Прод дээрх туршилтын өгөгдлийг устгана.
 *
 * ⚠ `scripts/reset-prod-testdata.sql`-тэй ИЖИЛ дараалал. Локал сан
 * дээр 10 гишүүн, 180 ирцтэй туршиж, ROLLBACK-аар шалгасан.
 *
 * ⚠ Бүгд НЭГ гүйлгээнд: дунд нь алдаа гарвал юу ч устахгүй.
 *
 * ⚠ Ажиллуулахын өмнө `prod-snapshot.ts` заавал.
 */
const STEPS: [string, string][] = [
  ['access_events', 'DELETE FROM access_events'],
  ['reminder_log', 'DELETE FROM reminder_log'],
  ['freeze_applications', 'DELETE FROM freeze_applications'],
  ['freezes', 'DELETE FROM freezes'],
  ['promotion_redemptions', 'DELETE FROM promotion_redemptions'],
  ['gift_cards', 'DELETE FROM gift_cards'],
  ['invoice_members', 'DELETE FROM invoice_members'],
  ['invoices', 'DELETE FROM invoices'],
  ['locker_assignments', 'DELETE FROM locker_assignments'],
  ['memberships', 'DELETE FROM memberships'],
  ['members', 'DELETE FROM members'],
  ['outbox', 'DELETE FROM outbox'],
  ['email_log', 'DELETE FROM email_log'],
  ['audit_log', 'DELETE FROM audit_log'],
  ['packages', 'DELETE FROM packages'],
  ['member_no_seq', 'ALTER SEQUENCE member_no_seq RESTART WITH 1001'],
];

const KEEP = ['staff_users', 'devices', 'lockers', 'settings'];

(async () => {
  /*
   * ⚠ ХАМГААЛАЛТ. Энэ скрипт ПРОД сангаас 400+ мөр устгадаг.
   * Санамсаргүй ажиллуулахаас сэргийлнэ.
   */
  if (process.env.PROD_WIPE !== 'yes-i-am-sure') {
    console.error(
      '⛔ PROD_WIPE=yes-i-am-sure өгнө үү.\n' +
        '   Энэ нь ПРОД сангийн гишүүд, ирц, нэхэмжлэхийг УСТГАНА.\n' +
        '   Өмнө нь `prod-snapshot.ts` ажиллуулсан эсэхээ шалгаарай.',
    );
    process.exit(1);
  }

  const url = fs
    .readFileSync('.env.railway', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL='))!
    .slice(13)
    .trim();
  const ds = new DataSource({
    type: 'postgres',
    url,
    ssl: { rejectUnauthorized: false },
    synchronize: false,
  });
  await ds.initialize();

  const q = ds.createQueryRunner();
  await q.connect();
  const count = async (t: string) =>
    Number((await q.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n);

  const before: Record<string, number> = {};
  for (const [t] of STEPS) if (t !== 'member_no_seq') before[t] = await count(t);
  for (const t of KEEP) before[t] = await count(t);

  await q.startTransaction();
  try {
    for (const [name, sql] of STEPS) {
      await q.query(sql);
      console.log(`  ✓ ${name}`);
    }
    await q.commitTransaction();
  } catch (e) {
    await q.rollbackTransaction();
    throw e;
  }

  console.log('\n  хүснэгт                  өмнө →  дараа');
  const all = [
    ...STEPS.map((s) => s[0]).filter((t) => t !== 'member_no_seq'),
    ...KEEP,
  ];
  let bad = 0;
  for (const t of all) {
    const after = await count(t);
    const keep = KEEP.includes(t);
    const ok = keep ? after === before[t] : after === 0;
    if (!ok) bad++;
    console.log(
      `  ${ok ? '✓' : '✗'} ${t.padEnd(22)}${String(before[t]).padStart(5)} → ${String(after).padStart(5)}` +
        (keep ? '   (ҮЛДЭХ ЁСТОЙ)' : ''),
    );
  }
  console.log(bad === 0 ? '\n✓ БҮГД ЗӨВ' : `\n✗ ${bad} хүснэгт буруу`);

  await q.release();
  await ds.destroy();
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
