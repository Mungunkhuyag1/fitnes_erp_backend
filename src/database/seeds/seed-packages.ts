import 'dotenv/config';
import { PackageAudience } from '../../common/enums/audience.enum';
import { Package } from '../../modules/package/package.entity';
import { AppDataSource } from '../data-source';

/**
 * Заалны ЖИНХЭНЭ үнийн самбарыг системд буулгана.
 *
 * Самбар дээр 13 мөр байдгаас 10 нь энд орно. Гарсан гурав:
 *   • Өдрийн эрх 30,000₮ — гишүүн үүсгэхгүй, ресепшн гараар тооцоолно
 *   • Шүүгээ 40,000₮      — багц биш, түрээсийн модуль хариуцна
 *
 * ⚠ Байгаа багцыг НЭРЭЭР нь олж шинэчилнэ, олдохгүйг нь үүсгэнэ.
 * Устгахгүй: `memberships` мөрүүд хуучин багцыг заасаар байх ёстой.
 * Жагсаалтад байхгүй хуучин багцыг ИДЭВХГҮЙ болгоно.
 */
const REAL: Array<Partial<Package> & { name: string }> = [
  // ── Энгийн гишүүнчлэл ──
  {
    name: '1 сар (анх удаа)',
    days: 30,
    price: '188000',
    audience: PackageAudience.STANDARD,
    firstTimeOnly: true,
    sortOrder: 10,
  },
  { name: '1 сар', days: 30, price: '250000', audience: PackageAudience.STANDARD, sortOrder: 20 },
  { name: '3 сар', days: 90, price: '600000', audience: PackageAudience.STANDARD, sortOrder: 30 },
  { name: '6 сар', days: 180, price: '1000000', audience: PackageAudience.STANDARD, sortOrder: 40 },
  { name: '12 сар', days: 365, price: '1800000', audience: PackageAudience.STANDARD, sortOrder: 50 },
  {
    name: 'Уурхайчны эрх 14 хоног',
    days: 14,
    price: '150000',
    audience: PackageAudience.STANDARD,
    sortOrder: 60,
  },

  // ── Хөнгөлөлттэй — ресепшн дээр баримт шалгана ──
  {
    name: 'Хотхоны оршин суугч 1 сар',
    days: 30,
    price: '200000',
    audience: PackageAudience.RESIDENT,
    requiresProof: true,
    sortOrder: 70,
  },
  {
    name: 'Ахмад настан 1 сар',
    days: 30,
    price: '150000',
    audience: PackageAudience.SENIOR,
    requiresProof: true,
    sortOrder: 80,
  },
  {
    name: 'Оюутан, сурагч 1 сар',
    days: 30,
    price: '160000',
    audience: PackageAudience.STUDENT,
    requiresProof: true,
    sortOrder: 90,
  },
  {
    name: 'Оюутан, сурагч 2 сар',
    days: 60,
    price: '300000',
    audience: PackageAudience.STUDENT,
    requiresProof: true,
    sortOrder: 100,
  },
  {
    name: 'Оюутан, сурагч 3 сар',
    days: 90,
    price: '420000',
    audience: PackageAudience.STUDENT,
    requiresProof: true,
    sortOrder: 110,
  },

  // ── Хосын багц — 2 суудал, зөвхөн ресепшн ──
  {
    name: 'Хосын багц 3 сар',
    days: 90,
    price: '1100000',
    audience: PackageAudience.COUPLE,
    seats: 2,
    online: false,
    sortOrder: 120,
  },
  {
    name: 'Хосын багц 6 сар',
    days: 180,
    price: '1800000',
    audience: PackageAudience.COUPLE,
    seats: 2,
    online: false,
    sortOrder: 130,
  },
];

async function main(): Promise<void> {
  if (process.env.SEED_CONFIRM !== 'true') {
    console.error('SEED_CONFIRM=true өгнө үү — багцын үнийг дарж бичнэ');
    process.exit(1);
  }

  const ds = await AppDataSource.initialize();
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
      console.log(`  ↻ ${row.name} — ${Number(row.price).toLocaleString()}₮`);
    } else {
      await repo.save(repo.create({ ...row, active: true }));
      created++;
      console.log(`  + ${row.name} — ${Number(row.price).toLocaleString()}₮`);
    }
  }

  // Жагсаалтад байхгүй хуучин багцыг ИДЭВХГҮЙ болгоно (устгахгүй).
  let retired = 0;
  for (const old of await repo.find({ where: { active: true } })) {
    if (keep.has(old.name)) continue;
    old.active = false;
    await repo.save(old);
    retired++;
    console.log(`  − ${old.name} — идэвхгүй болгов`);
  }

  console.log(`\n✓ шинэ ${created} · шинэчилсэн ${updated} · идэвхгүй ${retired}`);
  await ds.destroy();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
