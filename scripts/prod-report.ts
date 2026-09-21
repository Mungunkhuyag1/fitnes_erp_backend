import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as fs from 'fs';

/**
 * ПРОД САНГИЙН ТАЙЛАН — ЗӨВХӨН УНШИНА.
 *
 * ⚠ Энэ скрипт DELETE, UPDATE, ALTER огт агуулахгүй. Устгахын өмнө
 * юу байгааг нүдээр харах зорилготой.
 */
function url(): string {
  const line = fs
    .readFileSync('.env.railway', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('.env.railway дотор DATABASE_URL алга');
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

const TABLES = [
  'members', 'memberships', 'invoices', 'invoice_members', 'access_events',
  'locker_assignments', 'reminder_log', 'freezes', 'freeze_applications',
  'promotion_redemptions', 'gift_cards', 'outbox', 'email_log', 'audit_log',
  'packages', 'staff_users', 'devices', 'lockers', 'settings', 'promotions',
];

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    url: url(),
    ssl: { rejectUnauthorized: false },
    synchronize: false,
    logging: false,
  });
  await ds.initialize();
  console.log('✓ Прод сантай холбогдлоо\n');

  console.log('  хүснэгт                  мөр');
  console.log('  ─────────────────────────────');
  for (const t of TABLES) {
    try {
      const r = await ds.query(`SELECT count(*)::int AS n FROM ${t}`);
      console.log(`  ${t.padEnd(24)}${String(r[0].n).padStart(5)}`);
    } catch {
      console.log(`  ${t.padEnd(24)}    — (хүснэгт алга)`);
    }
  }

  console.log('\n── Гишүүдийн бүрэлдэхүүн ──');
  const m = await ds.query(`
    -- ⚠ member_no нь ТЕКСТ болсон: шууд min/max нь '999' > '1006' гэж
    --   буруу хариулна. Тоон утгыг нь л хөрвүүлж жишнэ.
    SELECT count(*)::int AS niit,
           min(member_no::int) FILTER (WHERE member_no ~ '^[0-9]+$') AS baga,
           max(member_no::int) FILTER (WHERE member_no ~ '^[0-9]+$') AS ih,
           count(*) FILTER (WHERE member_no !~ '^[0-9]+$')::int AS tekst,
           count(*) FILTER (WHERE note LIKE '%терминалаас импортлов%')::int AS importloson
    FROM members`);
  console.log(m[0]);

  console.log('\n── Эхний 10 гишүүн ──');
  for (const r of await ds.query(
    `SELECT member_no, name, status, note FROM members
       ORDER BY (member_no ~ '^[0-9]+$') DESC,
                CASE WHEN member_no ~ '^[0-9]+$' THEN member_no::bigint END,
                member_no
       LIMIT 10`,
  )) {
    console.log(
      `  №${String(r.member_no).padEnd(10)} ${String(r.name).padEnd(22)} ${r.status}  ${r.note ?? ''}`,
    );
  }

  console.log('\n── Багцууд ──');
  for (const r of await ds.query(
    `SELECT name, days, price, active FROM packages ORDER BY sort_order, name`,
  )) {
    console.log(
      `  ${String(r.name).padEnd(26)} ${String(r.days).padStart(4)} хоног  ${Number(r.price).toLocaleString().padStart(11)}₮  ${r.active ? 'идэвхтэй' : 'идэвхгүй'}`,
    );
  }

  console.log('\n── Ажилтны бүртгэл (ҮЛДЭНЭ) ──');
  for (const r of await ds.query(
    `SELECT email, name, role, active FROM staff_users ORDER BY role, email`,
  )) {
    console.log(`  ${String(r.email).padEnd(32)} ${String(r.role).padEnd(10)} ${r.active ? 'идэвхтэй' : 'хаалттай'}`);
  }

  await ds.destroy();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
