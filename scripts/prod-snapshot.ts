import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Устгахаас ӨМНӨХ нөөц — бүх хамрагдах хүснэгтийг JSON болгож хадгална.
 *
 * ⚠ Railway-гийн өөрийн backup-аас ГАДНА. Тэр нь бүх сангийн зураг
 * авдаг ба сэргээхэд бүхэлд нь буцаана; энэ нь хэрэв ганц мөр
 * хэрэгтэй болбол шууд харж болох хуулбар.
 */
const TABLES = [
  'members', 'memberships', 'invoices', 'invoice_members', 'access_events',
  'locker_assignments', 'reminder_log', 'freezes', 'freeze_applications',
  'promotion_redemptions', 'gift_cards', 'outbox', 'email_log', 'audit_log',
  'packages',
];

(async () => {
  const url = fs.readFileSync('.env.railway', 'utf8').split('\n')
    .find((l) => l.startsWith('DATABASE_URL='))!.slice(13).trim();
  const ds = new DataSource({ type: 'postgres', url, ssl: { rejectUnauthorized: false }, synchronize: false });
  await ds.initialize();

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dir = path.join('backups', `prod-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  let total = 0;
  for (const t of TABLES) {
    const rows = await ds.query(`SELECT * FROM ${t}`);
    fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows, null, 2));
    console.log(`  ${t.padEnd(24)}${String(rows.length).padStart(5)} мөр`);
    total += rows.length;
  }
  console.log(`\n✓ ${total} мөр → ${dir}`);
  await ds.destroy();
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
