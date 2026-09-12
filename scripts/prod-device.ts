import { DataSource } from 'typeorm';
import * as fs from 'fs';

/** Прод дээрх терминалын холболтын тохиргоо — ЗӨВХӨН УНШИНА. */
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

  const cols = await ds.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'devices' ORDER BY ordinal_position`,
  );
  console.log('── devices баганууд ──');
  console.log('  ' + cols.map((c: { column_name: string }) => c.column_name).join(', '));

  console.log('\n── Хадгалсан холболт ──');
  for (const d of await ds.query(`SELECT * FROM devices`)) {
    for (const [k, v] of Object.entries(d)) {
      // Нууц үгийг харуулахгүй — зөвхөн тавигдсан эсэхийг.
      const shown =
        /pass|secret|token/i.test(k) && v ? `<тавигдсан, ${String(v).length} тэмдэгт>` : v;
      console.log(`  ${k.padEnd(22)} ${shown ?? '—'}`);
    }
  }
  await ds.destroy();
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
