import { DataSource } from 'typeorm';
import * as fs from 'fs';
import { Package } from '../src/modules/package/package.entity';
import { REAL } from '../src/database/seeds/seed-packages';

/**
 * Жинхэнэ багцуудыг ПРОД сан руу.
 *
 * ⚠ `seed-packages.ts`-ийн жагсаалтыг ДАХИН БИЧИХГҮЙ, импортлоно —
 * хоёр газар үнэ хадгалвал нэг нь хоцрох нь цаг хугацааны асуудал.
 *
 * Нэрээр нь тааруулж upsert хийнэ; жагсаалтад байхгүй хуучин багцыг
 * ИДЭВХГҮЙ болгоно (устгахгүй — түүхэн гишүүнчлэл заасан байж болно).
 */
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
    entities: [Package],
  });
  await ds.initialize();
  const repo = ds.getRepository(Package);

  const keep = new Set(REAL.map((p) => p.name));
  let created = 0;
  let updated = 0;

  for (const row of REAL) {
    const found = await repo.findOne({ where: { name: row.name } });
    if (found) {
      Object.assign(found, row, { active: true });
      await repo.save(found);
      updated++;
    } else {
      await repo.save(repo.create({ ...row, active: true }));
      created++;
    }
    console.log(
      `  ${found ? '↻' : '+'} ${row.name.padEnd(26)} ${Number(row.price).toLocaleString().padStart(11)}₮`,
    );
  }

  let retired = 0;
  for (const old of await repo.find({ where: { active: true } })) {
    if (keep.has(old.name)) continue;
    old.active = false;
    await repo.save(old);
    retired++;
    console.log(`  − ${old.name} — идэвхгүй болгов`);
  }

  console.log(
    `\n✓ шинэ ${created} · шинэчилсэн ${updated} · идэвхгүй ${retired}`,
  );
  await ds.destroy();
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
