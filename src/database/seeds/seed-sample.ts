import 'dotenv/config';
import { randomBytes } from 'crypto';
import { AccessEvent, AccessReason } from '../../modules/access/access-event.entity';
import { Device } from '../../modules/device/device.entity';
import { Gender } from '../../common/enums/gender.enum';
import { Invoice } from '../../modules/invoice/invoice.entity';
import {
  InvoiceStatus,
  MemberStatus,
  MembershipSource,
} from '../../common/enums/member-status.enum';
import { Locker } from '../../modules/locker/locker.entity';
import {
  LockerAssignment,
  LockerAssignmentType,
} from '../../modules/locker/locker-assignment.entity';
import { Member } from '../../modules/member/member.entity';
import { Membership } from '../../modules/membership/membership.entity';
import { Package } from '../../modules/package/package.entity';
import { SETTING_DEFAULTS } from '../../modules/settings/settings.service';
import { AppDataSource } from '../data-source';

/**
 * Жижиг, ТУУШТАЙ жишээ өгөгдөл — 10 гишүүн.
 *
 *   npm run seed:sample
 *
 * `seed:demo`-оос ялгаатай нь: 60 гишүүн, 4000 ирц биш, харин гар аргаар
 * зохиосон 10 бүртгэл. Төлөв бүр (`lead`/`active`/`expired`/`suspended`/
 * `cancelled`), картын шат бүр, шүүгээний хоёр төрөл, нэхэмжлэхийн төлөв
 * бүр төлөөлөгдөнө — дэлгэц бүрийг бодит мэт өгөгдөл дээр шалгаж болно.
 *
 * ★ ТУУШТАЙ БАЙДЛЫН ДҮРМҮҮД (зөрчвөл тайлан, шүүлтүүр худал болно):
 *
 *   1. `access_ends_at` = СҮҮЛИЙН гишүүнчлэлийн `ends_at`
 *   2. Гишүүнчлэлүүд ЗАЛГАА: дараагийнх нь өмнөхийнхөө төгсгөлөөс эхэлнэ
 *   3. Төлөв нь огноотой нийцнэ:
 *        active    → access_ends_at > одоо
 *        expired   → access_ends_at ≤ одоо
 *        suspended → огноо нь хүчинтэй ч гараар зогсоосон
 *        lead      → гишүүнчлэл БАЙХГҮЙ, access_ends_at = null
 *        cancelled → түүхтэй ч Loopy жагсаалтаас хасагдсан
 *   4. Ирц зөвхөн ХҮЧИНТЭЙ хугацаанд, зөвшөөрөгдсөнөөр бүртгэгдэнэ.
 *      Хугацаа дууссаны дараах оролдлого нь `granted=false` + шалтгаантай.
 *   5. Шүүгээ зөвхөн идэвхтэй гишүүнд. Түрээсийн дуусах хугацаа нь
 *      гишүүний эрхээс ХЭТРЭХГҮЙ.
 *   6. `face_enrolled` нь `hik_synced_at`-гүйгээр үнэн байж болохгүй.
 *   7. Картгүй гишүүн `wallet_devices`-тэй байж болохгүй.
 */

const TZ_OFFSET_MS = 8 * 3600_000; // Asia/Ulaanbaatar

/** Тухайн өдрийн 23:59:59.999 (УБ-ын цагаар) — эрх ийм мөчид дуусдаг. */
function endOfDay(d: Date): Date {
  const local = new Date(d.getTime() + TZ_OFFSET_MS);
  local.setUTCHours(23, 59, 59, 999);
  return new Date(local.getTime() - TZ_OFFSET_MS);
}

const daysFromNow = (n: number, now: Date) =>
  new Date(now.getTime() + n * 86_400_000);

/** Тодорхойлолт — уншихад бүх гишүүн нэг дор харагдана. */
interface Spec {
  name: string;
  phone: string;
  gender: Gender | null;
  email?: string;
  note?: string;
  status: MemberStatus;
  /** Багцын индекс + хэдэн хоногийн өмнө худалдаж авсан (сүүлийнх нь эцэст). */
  purchases: { pkg: number; boughtDaysAgo: number; source: MembershipSource }[];
  /** Wallet карт: `null` = Loopy-д бүртгүүлээгүй. */
  card: null | { devices: number };
  face: boolean;
  /** Бүсийн ИНДЕКС — нэрийг `SETTING_DEFAULTS.locker_zones`-оос авна. */
  locker?: { zone: number; number: number; type: LockerAssignmentType };
  /** Хугацаа дууссаны дараа орох гэж оролдсон эсэх. */
  deniedTries?: number;
  pendingInvoice?: number;
}

const SPECS: Spec[] = [
  {
    name: 'Батбаяр Дорж',
    phone: '99118801', gender: Gender.MALE, email: 'batbayar@example.mn',
    status: MemberStatus.ACTIVE,
    purchases: [
      { pkg: 0, boughtDaysAgo: 95, source: MembershipSource.CASH },
      { pkg: 1, boughtDaysAgo: 65, source: MembershipSource.BONUM },
    ],
    card: { devices: 2 }, face: true,
    locker: { zone: 0, number: 3, type: LockerAssignmentType.RENTAL },
  },
  {
    name: 'Оюунчимэг Ганбат',
    phone: '99118802', gender: Gender.FEMALE,
    status: MemberStatus.ACTIVE,
    purchases: [{ pkg: 0, boughtDaysAgo: 12, source: MembershipSource.CASH }],
    card: { devices: 1 }, face: true,
    locker: { zone: 1, number: 2, type: LockerAssignmentType.DAILY },
  },
  {
    name: 'Тэмүүлэн Баяр',
    phone: '99118803', gender: Gender.MALE, email: 'temuulen@example.mn',
    note: 'Жилийн гишүүн — VIP',
    status: MemberStatus.ACTIVE,
    purchases: [{ pkg: 3, boughtDaysAgo: 40, source: MembershipSource.BONUM }],
    card: { devices: 1 }, face: true,
    locker: { zone: 0, number: 7, type: LockerAssignmentType.RENTAL },
  },
  {
    name: 'Сарантуяа Пүрэв',
    phone: '99118804', gender: Gender.FEMALE,
    note: 'Эрх удахгүй дуусна — сунгалт санал болгох',
    status: MemberStatus.ACTIVE,
    purchases: [{ pkg: 0, boughtDaysAgo: 25, source: MembershipSource.CASH }],
    // Карт үүссэн ч утсандаа хараахан нэмээгүй.
    card: { devices: 0 }, face: true,
  },
  {
    name: 'Ганзориг Түвшин',
    phone: '99118805', gender: Gender.MALE,
    status: MemberStatus.EXPIRED,
    purchases: [{ pkg: 0, boughtDaysAgo: 62, source: MembershipSource.CASH }],
    card: { devices: 1 }, face: true,
    deniedTries: 2,
  },
  {
    name: 'Наранцэцэг Сүх',
    phone: '99118806', gender: Gender.FEMALE, email: 'narantsetseg@example.mn',
    note: 'Онлайнаар сунгах гэж байгаа',
    status: MemberStatus.EXPIRED,
    purchases: [{ pkg: 1, boughtDaysAgo: 140, source: MembershipSource.BONUM }],
    card: { devices: 1 }, face: true,
    deniedTries: 1,
    pendingInvoice: 0,
  },
  {
    name: 'Мөнхбат Одгэрэл',
    phone: '99118807', gender: Gender.MALE,
    note: 'Гэмтлийн улмаас түр зогсоов',
    status: MemberStatus.SUSPENDED,
    purchases: [{ pkg: 1, boughtDaysAgo: 30, source: MembershipSource.CASH }],
    card: { devices: 1 }, face: true,
  },
  {
    name: 'Энхжаргал Няма',
    phone: '99118808', gender: Gender.FEMALE,
    note: 'Танилцах уулзалт хийсэн, төлбөр хийгээгүй',
    status: MemberStatus.LEAD,
    purchases: [],
    // Төлбөр хийгээгүй тул Loopy руу ч, терминал руу ч бичигдээгүй.
    card: null, face: false,
  },
  {
    name: 'Ариунаа Цэрэн',
    phone: '99118809', gender: Gender.FEMALE,
    note: 'Хот хөдөлсөн — цуцлав',
    status: MemberStatus.CANCELLED,
    purchases: [{ pkg: 0, boughtDaysAgo: 120, source: MembershipSource.CASH }],
    // Цуцлахад терминалаас устгагдсан тул царай нь ч алга.
    card: null, face: false,
  },
  {
    name: 'Билгүүн Батаа',
    phone: '99118810', gender: Gender.MALE, email: 'bilguun@example.mn',
    status: MemberStatus.ACTIVE,
    purchases: [
      { pkg: 0, boughtDaysAgo: 70, source: MembershipSource.BONUM },
      { pkg: 2, boughtDaysAgo: 38, source: MembershipSource.BONUM },
    ],
    card: { devices: 1 }, face: true,
  },
];

async function main(): Promise<void> {
  if (process.env.SEED_SAMPLE !== 'true') {
    console.error('⛔ Хамгаалалт: SEED_SAMPLE=true гэж ил зөвшөөрнө үү.');
    console.error('   Энэ скрипт гишүүд, ирц, шүүгээг УСТГААД шинээр үүсгэнэ.');
    process.exit(1);
  }

  await AppDataSource.initialize();
  const ds = AppDataSource;
  const now = new Date();

  // ── Цэвэрлэх (ажилтан, тохиргоог ХӨНДӨХГҮЙ) ──
  console.log('Хуучин жишээ өгөгдлийг цэвэрлэж байна…');
  await ds.query(
    `TRUNCATE access_events, memberships, locker_assignments, lockers,
              invoices, outbox, audit_log, reminder_log RESTART IDENTITY CASCADE`,
  );
  await ds.query(`DELETE FROM members`);
  await ds.query(`DELETE FROM devices`);
  await ds.query(`ALTER SEQUENCE member_no_seq RESTART WITH 1001`);

  // ── Терминал ──
  const device = await ds.getRepository(Device).save(
    ds.getRepository(Device).create({
      name: 'Гол хаалга',
      serial: 'DS-K1T320MFX-0001',
      model: 'DS-K1T320MFX',
      ip: '192.168.1.64',
      doorNo: 1,
      firmware: 'V3.2.30',
      online: true,
      lastSeenAt: now,
    }),
  );

  // ── Багц ──
  const pkgRepo = ds.getRepository(Package);
  let packages = await pkgRepo.find({ order: { sortOrder: 'ASC' } });
  if (!packages.length) {
    packages = await pkgRepo.save([
      pkgRepo.create({ name: '1 сарын багц', days: 30, price: '90000', sortOrder: 1 }),
      pkgRepo.create({ name: '3 сарын багц', days: 90, price: '240000', sortOrder: 2 }),
      pkgRepo.create({ name: '6 сарын багц', days: 180, price: '450000', sortOrder: 3 }),
      pkgRepo.create({ name: '1 жилийн багц', days: 365, price: '800000', sortOrder: 4 }),
    ]);
  }

  // ── Шүүгээ (A бүс 10, B бүс 6) ──
  // ⚠ Бүсийн нэр нь ТОХИРГООНООС ирнэ. Дурын нэр (`A`, `B`) өгвөл
  // самбар нь тохируулсан өрөөнүүдээр шүүдэг тул шүүгээ ОГТ ХАРАГДАХГҮЙ.
  const ZONES = SETTING_DEFAULTS.locker_zones;
  const lockerRepo = ds.getRepository(Locker);
  const lockers = await lockerRepo.save([
    ...Array.from({ length: 10 }, (_, i) =>
      lockerRepo.create({ zone: ZONES[0], number: i + 1, active: true }),
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      lockerRepo.create({ zone: ZONES[1], number: i + 1, active: true }),
    ),
  ]);
  const lockerOf = (zoneIdx: number, number: number) => {
    const zone = ZONES[zoneIdx];
    const l = lockers.find((x) => x.zone === zone && x.number === number);
    if (!l) throw new Error(`Шүүгээ олдсонгүй: ${zone} №${number}`);
    return l;
  };

  // ── Гишүүд ──
  const memberRepo = ds.getRepository(Member);
  const msRepo = ds.getRepository(Membership);
  const invRepo = ds.getRepository(Invoice);
  const asgRepo = ds.getRepository(LockerAssignment);
  const evRepo = ds.getRepository(AccessEvent);

  let events = 0;
  let memberships = 0;

  for (const [i, spec] of SPECS.entries()) {
    const [{ nextval }] = await ds.query<{ nextval: string }[]>(
      `SELECT nextval('member_no_seq')`,
    );
    const memberNo = Number(nextval);

    // Хамгийн эртний худалдан авалтаас өмнө бүртгүүлсэн байна.
    const oldest = spec.purchases.length
      ? Math.max(...spec.purchases.map((p) => p.boughtDaysAgo))
      : 3;
    const createdAt = daysFromNow(-(oldest + 2), now);

    const member = memberRepo.create({
      memberNo,
      name: spec.name,
      phone: spec.phone,
      email: spec.email ?? null,
      note: spec.note ?? null,
      gender: spec.gender,
      status: spec.status,
      payToken: randomBytes(24).toString('base64url'),
      // ★ Дүрэм 6: терминал руу бичигдээгүй бол царай бүртгэгдэх боломжгүй.
      faceEnrolled: spec.face,
      faceEnrolledAt: spec.face ? daysFromNow(-(oldest + 1), now) : null,
      hikSyncedAt: spec.face ? daysFromNow(-(oldest + 2), now) : null,
      // ★ Дүрэм 7: карт байхгүй бол wallet тоолуур утгагүй.
      loopyAllowedAt: spec.card ? daysFromNow(-(oldest + 1), now) : null,
      loopyCardSerial: spec.card ? `WF${String(memberNo).padStart(6, '0')}` : null,
      walletDevices: spec.card ? spec.card.devices : null,
      walletCheckedAt: spec.card ? now : null,
      createdAt,
    });
    await memberRepo.save(member);

    // ── Гишүүнчлэл: ★ Дүрэм 2 — залгаа хугацаа ──
    let cursor: Date | null = null;
    for (const [j, p] of spec.purchases.entries()) {
      const pkg = packages[p.pkg];
      const boughtAt = daysFromNow(-p.boughtDaysAgo, now);
      // Өмнөх эрх дуусаагүй байхад сунгавал үлдэгдэл хоног АЛДАГДАХГҮЙ.
      const startsAt = cursor && cursor > boughtAt ? cursor : boughtAt;
      const endsAt = endOfDay(daysFromNow(0, new Date(
        startsAt.getTime() + pkg.days * 86_400_000,
      )));

      let invoiceId: string | null = null;
      if (p.source === MembershipSource.BONUM) {
        const inv = await invRepo.save(
          invRepo.create({
            memberId: member.id,
            packageId: pkg.id,
            packageName: pkg.name,
            days: pkg.days,
            amount: pkg.price,
            status: InvoiceStatus.PAID,
            provider: 'bonum',
            transactionId: `WF-${memberNo}-${j}-${boughtAt.getTime()}`,
            providerInvoiceId: `BNM${randomBytes(4).toString('hex').toUpperCase()}`,
            paidAt: boughtAt,
            expiresAt: new Date(boughtAt.getTime() + 300_000),
            createdAt: boughtAt,
          }),
        );
        invoiceId = inv.id;
      }

      await msRepo.save(
        msRepo.create({
          memberId: member.id,
          packageId: pkg.id,
          packageName: pkg.name,
          days: pkg.days,
          amount: pkg.price,
          source: p.source,
          invoiceId,
          startsAt,
          endsAt,
          idempotencyKey: `sample-${memberNo}-${j}`,
          createdAt: boughtAt,
        }),
      );
      memberships++;
      cursor = endsAt;
    }

    // ★ Дүрэм 1 + 3: огноо ба төлөв заавал нийцнэ.
    member.accessEndsAt = cursor;
    if (cursor) {
      const future = cursor > now;
      const ok =
        (spec.status === MemberStatus.ACTIVE && future) ||
        (spec.status === MemberStatus.EXPIRED && !future) ||
        (spec.status === MemberStatus.SUSPENDED && future) ||
        spec.status === MemberStatus.CANCELLED;
      if (!ok) {
        throw new Error(
          `⛔ ${spec.name}: төлөв «${spec.status}» нь ${cursor.toISOString()} ` +
            `дуусах огноотой зөрчилдөж байна`,
        );
      }
    } else if (spec.status !== MemberStatus.LEAD) {
      throw new Error(`⛔ ${spec.name}: гишүүнчлэлгүй мөртлөө «${spec.status}»`);
    }

    // ── Хүлээгдэж буй нэхэмжлэх ──
    if (spec.pendingInvoice !== undefined) {
      const pkg = packages[spec.pendingInvoice];
      await invRepo.save(
        invRepo.create({
          memberId: member.id,
          packageId: pkg.id,
          packageName: pkg.name,
          days: pkg.days,
          amount: pkg.price,
          status: InvoiceStatus.PENDING,
          provider: 'bonum',
          transactionId: `WF-PENDING-${memberNo}`,
          providerInvoiceId: `BNM${randomBytes(4).toString('hex').toUpperCase()}`,
          payUrl: 'https://testapi.bonum.mn/pay/demo',
          // 5 минутын дараа хугацаа дуусна (invoice.scheduler цуцална).
          expiresAt: new Date(now.getTime() + 4 * 60_000),
          createdAt: new Date(now.getTime() - 60_000),
        }),
      );
    }

    // ── Шүүгээ: ★ Дүрэм 5 ──
    if (spec.locker && member.accessEndsAt && member.accessEndsAt > now) {
      const l = lockerOf(spec.locker.zone, spec.locker.number);
      const rental = spec.locker.type === LockerAssignmentType.RENTAL;
      await asgRepo.save(
        asgRepo.create({
          lockerId: l.id,
          lockerZone: l.zone,
          lockerNumber: l.number,
          memberId: member.id,
          type: spec.locker.type,
          issuedAt: daysFromNow(rental ? -10 : 0, now),
          // CK_locker_asg_due: rental → due_at ЗААВАЛ, daily → ЗААВАЛ null.
          // Түрээс нь гишүүний эрхээс хэтрэхгүй.
          dueAt: rental ? member.accessEndsAt : null,
          amount: rental ? '30000' : '0',
          source: rental ? 'cash' : null,
        }),
      );
    }

    // ── Ирц: ★ Дүрэм 4 ──
    const first = spec.purchases.length
      ? daysFromNow(-Math.max(...spec.purchases.map((p) => p.boughtDaysAgo)), now)
      : null;
    if (first && member.accessEndsAt) {
      const until = member.accessEndsAt < now ? member.accessEndsAt : now;
      // 2–3 хоног тутам ирдэг гэж үзье.
      const step = 2 + (i % 2);
      let visits = 0;
      for (
        let t = first.getTime() + 86_400_000;
        t < until.getTime();
        t += step * 86_400_000
      ) {
        const at = new Date(t + (9 + (i % 10)) * 3600_000);
        if (at > now) break;
        await evRepo.save(
          evRepo.create({
            deviceId: device.id,
            memberId: member.id,
            employeeNo: memberNo,
            eventAt: at,
            granted: true,
            reason: AccessReason.OK,
            verifyMode: 'face',
            dedupeKey: `sample-${memberNo}-${at.getTime()}`,
          }),
        );
        visits++;
        events++;
      }
      if (visits) {
        member.lastVisitAt = new Date(
          Math.min(until.getTime(), now.getTime()) - 3600_000,
        );
      }
    }

    // Хугацаа дууссаны ДАРААХ оролдлого — татгалзана.
    for (let k = 0; k < (spec.deniedTries ?? 0); k++) {
      const at = daysFromNow(-(k * 3 + 1), now);
      if (member.accessEndsAt && at <= member.accessEndsAt) continue;
      await evRepo.save(
        evRepo.create({
          deviceId: device.id,
          memberId: member.id,
          employeeNo: memberNo,
          eventAt: at,
          granted: false,
          reason: AccessReason.EXPIRED,
          verifyMode: 'face',
          dedupeKey: `sample-denied-${memberNo}-${k}`,
        }),
      );
      events++;
    }

    await memberRepo.save(member);
  }

  // ── Товч ──
  const [sum] = await ds.query<Record<string, string>[]>(`
    SELECT (SELECT count(*) FROM members)             AS members,
           (SELECT count(*) FROM memberships)         AS memberships,
           (SELECT count(*) FROM access_events)       AS events,
           (SELECT count(*) FROM lockers)             AS lockers,
           (SELECT count(*) FROM locker_assignments)  AS assignments,
           (SELECT count(*) FROM invoices)            AS invoices,
           (SELECT count(*) FROM packages)            AS packages`);

  console.log('\n✓ Жишээ өгөгдөл бэлэн');
  for (const [k, v] of Object.entries(sum)) console.log(`   ${k.padEnd(12)} ${v}`);
  console.log(`   (гишүүнчлэл ${memberships}, ирц ${events})`);

  await AppDataSource.destroy();
}

main().catch((e: unknown) => {
  console.error('✗ Seed амжилтгүй:', e instanceof Error ? e.message : e);
  process.exit(1);
});
