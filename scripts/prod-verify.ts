import { DataSource } from 'typeorm';
import * as fs from 'fs';

/** Прод сангийн эцсийн байдал — ЗӨВХӨН УНШИНА. */
(async () => {
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

  const n = async (t: string) =>
    Number((await ds.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n);

  console.log('── Цэвэрлэгдсэн байх ёстой ──');
  for (const t of [
    'members', 'memberships', 'invoices', 'access_events',
    'locker_assignments', 'outbox', 'audit_log', 'email_log',
  ]) {
    const c = await n(t);
    console.log(`  ${c === 0 ? '✓' : '✗'} ${t.padEnd(20)}${String(c).padStart(5)}`);
  }

  console.log('\n── Үлдсэн байх ёстой ──');
  for (const t of ['staff_users', 'devices', 'lockers', 'settings']) {
    const c = await n(t);
    console.log(`  ${c > 0 ? '✓' : '✗'} ${t.padEnd(20)}${String(c).padStart(5)}`);
  }

  console.log('\n── Багцууд ──');
  const pkgs = await ds.query(
    `SELECT name, days, price, audience, active FROM packages ORDER BY sort_order, name`,
  );
  for (const p of pkgs) {
    console.log(
      `  ${p.active ? '●' : '○'} ${String(p.name).padEnd(26)}${String(p.days).padStart(4)} хоног ${Number(p.price).toLocaleString().padStart(11)}₮  ${p.audience}`,
    );
  }
  console.log(`\n  нийт ${pkgs.length} · идэвхтэй ${pkgs.filter((p: { active: boolean }) => p.active).length}`);

  console.log('\n── Гишүүний дугаарын дараалал ──');
  const s = await ds.query(`SELECT last_value, is_called FROM member_no_seq`);
  console.log(`  ${s[0].last_value} (is_called=${s[0].is_called})`);

  await ds.destroy();
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
