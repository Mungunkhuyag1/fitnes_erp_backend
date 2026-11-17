import 'dotenv/config';
import { randomBytes } from 'crypto';
import {
  MembershipSource,
  MemberStatus,
} from '../../common/enums/member-status.enum';
import { replayLedger } from '../../common/utils/ledger.util';
import { Member } from '../../modules/member/member.entity';
import { Membership } from '../../modules/membership/membership.entity';
import { Package } from '../../modules/package/package.entity';
import { AppDataSource } from '../data-source';

/**
 * Оролтын багцыг ГАРААР туршихад зориулсан ЖИЖИГ тест өгөгдөл.
 *
 *   npm run seed:entries
 *
 * Гишүүн бүр нэг тохиолдлыг төлөөлнө (нэрэнд нь бичсэн):
 *   1. Хоногийн эрхтэй              → уншуулахад оролт ХАСАГДАХГҮЙ
 *   2. 12/60 шинэ                   → уншуулахад 12 → 11
 *   3. 11/12 ашигласан (1 үлдсэн)   → дараагийн уншуулалт эрхийг ХААНА
 *   4. Дууссан + хойш 30 хоног      → хаагдсан агшнаас 30 хоног эхэлсэн
 *   5. Эрхгүй (lead)                → сунгах цонхоор оролт нэмж турших
 *
 * ⚠ Зөвхөн хөгжүүлэлтийн санд. Production дээр ажиллахгүй.
 */

const TZ = 'Asia/Ulaanbaatar';
const DAY = 86_400_000;

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:entries нь production дээр ажиллахгүй');
  }
  const ds = await AppDataSource.initialize();
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  // ── Багцууд ──
  const pkgRepo = ds.getRepository(Package);
  const ensure = async (name: string, days: number, entries: number | null, price: string, sortOrder: number) =>
    (await pkgRepo.findOne({ where: { name } })) ??
    pkgRepo.save(pkgRepo.create({ name, days, entries, price, sortOrder }));

  const month = await ensure('1 сарын багц', 30, null, '90000', 1);
  const e12 = await ensure('12 оролт · 60 хоног', 60, 12, '120000', 5);
  await ensure('8 оролт · 30 хоног', 30, 8, '80000', 6);

  // ── Гишүүд ──
  const memberRepo = ds.getRepository(Member);
  const msRepo = ds.getRepository(Membership);

  type Row = { pkg: Package; boughtDaysAgo: number; used?: number; closedDaysAgo?: number };
  const specs: { name: string; phone: string; rows: Row[] }[] = [
    { name: 'Тест 1 · Хоногийн', phone: '90000001', rows: [{ pkg: month, boughtDaysAgo: 5 }] },
    { name: 'Тест 2 · 12/60 шинэ', phone: '90000002', rows: [{ pkg: e12, boughtDaysAgo: 2 }] },
    { name: 'Тест 3 · 1 оролт үлдсэн', phone: '90000003', rows: [{ pkg: e12, boughtDaysAgo: 20, used: 11 }] },
    {
      name: 'Тест 4 · Дууссан + хойш',
      phone: '90000004',
      rows: [
        { pkg: e12, boughtDaysAgo: 40, used: 12, closedDaysAgo: 10 },
        { pkg: month, boughtDaysAgo: 30 },
      ],
    },
    { name: 'Тест 5 · Эрхгүй', phone: '90000005', rows: [] },
  ];

  for (const spec of specs) {
    if (await memberRepo.findOne({ where: { phone: spec.phone } })) {
      console.log(`  · ${spec.name} — аль хэдийн байна`);
      continue;
    }
    const [{ nextval }] = await ds.query<{ nextval: string }[]>(`SELECT nextval('member_no_seq')`);
    const member = await memberRepo.save(
      memberRepo.create({
        memberNo: nextval,
        name: spec.name,
        phone: spec.phone,
        status: MemberStatus.LEAD,
        payToken: randomBytes(24).toString('base64url'),
        createdAt: ago(45),
      }),
    );

    // Мөрүүдийг эхлээд бичиж, дараа нь бодит дүрмээр (replayLedger)
    // эхлэл/төгсгөлийг тооцно — апп-тай ЯГ ижил огноо гарна.
    const rows: Membership[] = spec.rows.map((r, j) =>
      msRepo.create({
        memberId: member.id,
        packageId: r.pkg.id,
        packageName: r.pkg.name,
        days: r.pkg.days,
        entries: r.pkg.entries,
        entriesUsed: r.used ?? 0,
        closedAt: r.closedDaysAgo !== undefined ? ago(r.closedDaysAgo) : null,
        amount: r.pkg.price,
        source: MembershipSource.CASH,
        startsAt: ago(r.boughtDaysAgo),
        endsAt: ago(r.boughtDaysAgo),
        paidAt: ago(r.boughtDaysAgo),
        idempotencyKey: `seed-entries-${nextval}-${j}`,
        createdAt: ago(r.boughtDaysAgo),
      }),
    );
    if (rows.length) {
      await msRepo.save(rows); // ID авна
      // ⚠ Хадгалсан эхлэлийг нууна: `createdAt`-тэй тэнцүү эхлэл нь
      // «цуцлаад сэргээсэн» дүрмийг өдөөж өмнөх бүлгийг тасална.
      const segs = replayLedger(
        rows.map((r) => ({ ...r, startsAt: undefined })),
        TZ,
        rows[0].startsAt,
      );
      for (const s of segs) {
        const head = rows.find((x) => x.id === s.headId)!;
        head.startsAt = s.start;
        head.endsAt = s.end;
      }
      await msRepo.save(rows);
      const end = segs[segs.length - 1].end;
      member.accessEndsAt = end;
      member.status = end > now ? MemberStatus.ACTIVE : MemberStatus.EXPIRED;
      await memberRepo.save(member);
    }
    console.log(`  ✓ №${nextval} ${spec.name} → ${member.accessEndsAt?.toISOString() ?? 'эрхгүй'}`);
  }

  await ds.destroy();
  console.log('\n✓ Тест өгөгдөл бэлэн');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
