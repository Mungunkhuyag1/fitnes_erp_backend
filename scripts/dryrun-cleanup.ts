import { AppDataSource } from '../src/database/data-source';
import * as fs from 'fs';

/**
 * SQL-ийг ЛОКАЛ сан дээр туршина — бүх мөрийг ажиллуулаад ROLLBACK.
 * Хүснэгт/баганын нэр, дараалал зөв эсэхийг батална. Юу ч устахгүй.
 */
async function main() {
  const ds = await AppDataSource.initialize();
  const sql = fs.readFileSync('scripts/reset-prod-testdata.sql', 'utf8');

  // 2-р алхмын DELETE-үүдийг л авна.
  const body = sql.slice(sql.indexOf('BEGIN;') + 6, sql.indexOf('COMMIT;'));
  const stmts = body
    .split(';')
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .filter(Boolean);

  const TABLES = [
    'access_events', 'reminder_log', 'freeze_applications', 'freezes',
    'promotion_redemptions', 'gift_cards', 'invoice_members', 'invoices',
    'locker_assignments', 'memberships', 'members', 'outbox',
    'email_log', 'audit_log', 'packages',
    // ҮЛДЭХ ёстой — уствал АЛДАА
    'staff_users', 'devices', 'lockers', 'settings',
  ];

  const q = ds.createQueryRunner();
  await q.connect();

  const count = async (t: string): Promise<number> =>
    Number((await q.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n);

  const before: Record<string, number> = {};
  for (const t of TABLES) before[t] = await count(t);

  await q.startTransaction();
  try {
    for (const s of stmts) {
      await q.query(s);
      console.log(`  ✓ ${s.split('\n')[0].slice(0, 56)}`);
    }

    console.log('\n  хүснэгт                өмнө →  дараа');
    let bad = 0;
    for (const t of TABLES) {
      const after = await count(t);
      const keep = ['staff_users', 'devices', 'lockers', 'settings'].includes(t);
      const ok = keep ? after === before[t] : after === 0;
      if (!ok) bad++;
      console.log(
        `  ${ok ? '✓' : '✗'} ${t.padEnd(22)} ${String(before[t]).padStart(5)} → ${String(after).padStart(5)}` +
          (keep ? '   (ҮЛДЭХ ЁСТОЙ)' : ''),
      );
    }
    console.log(bad === 0 ? '\n✓ БҮГД ЗӨВ' : `\n✗ ${bad} хүснэгт буруу`);
  } finally {
    await q.rollbackTransaction();   // ← юу ч устахгүй
    await q.release();
    await ds.destroy();
  }
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
