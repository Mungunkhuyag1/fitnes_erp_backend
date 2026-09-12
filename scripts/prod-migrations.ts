import { DataSource } from 'typeorm';
import * as fs from 'fs';

/** Прод дээр ямар migration ажилласан бэ — ЗӨВХӨН УНШИНА. */
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

  const rows = await ds.query(
    `SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 6`,
  );
  console.log('── Сүүлийн 6 migration ──');
  for (const r of rows) console.log(`  ${r.name}`);

  const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM migrations`);
  console.log(`\n  нийт ${n}`);

  const [col] = await ds.query(
    `SELECT character_maximum_length AS len FROM information_schema.columns
     WHERE table_name='devices' AND column_name='ip'`,
  );
  console.log(
    `\n  devices.ip урт: ${col.len}  ${col.len >= 255 ? '✓ домэйн багтана' : '✗ 45 хэвээр'}`,
  );

  await ds.destroy();
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
