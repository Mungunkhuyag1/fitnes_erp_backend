import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'crypto';
import { createHash } from 'crypto';
import {
  MembershipSource,
  MemberStatus,
} from '../../common/enums/member-status.enum';
import { Role } from '../../common/enums/role.enum';
import { AccessEvent, AccessReason } from '../../modules/access/access-event.entity';
import { Device } from '../../modules/device/device.entity';
import { Member } from '../../modules/member/member.entity';
import { LockerAssignment, LockerAssignmentType } from '../../modules/locker/locker-assignment.entity';
import { Locker } from '../../modules/locker/locker.entity';
import { Membership } from '../../modules/membership/membership.entity';
import { Package } from '../../modules/package/package.entity';
import { StaffUser } from '../../modules/staff/staff-user.entity';
import { AppDataSource } from '../data-source';

/**
 * Хөгжүүлэлтийн демо өгөгдөл.
 *
 * Зорилго нь зөвхөн «мөр байлгах» биш — dashboard, тайлан, график БОДИТОЙ
 * харагдах ёстой. Тиймээс ирцийг санамсаргүй биш, жинхэнэ фитнесийн
 * хэв маягаар тараана: өглөө/оройн оргил, амралтын өдөр цөөн, гишүүн бүр
 * өөрийн ирэх давтамжтай.
 *
 *   npm run seed:demo
 */

const TZ_OFFSET_H = 8; // Asia/Ulaanbaatar

const FIRST = [
  'Батаа', 'Сараа', 'Дорж', 'Оюун', 'Ганбат', 'Цэцэг', 'Мөнх', 'Алтан',
  'Билгүүн', 'Наран', 'Тэмүүлэн', 'Хулан', 'Энхтуяа', 'Баясгалан', 'Золбоо',
  'Нямдорж', 'Ундрах', 'Гэрэл', 'Тэнгис', 'Сувд', 'Ариунаа', 'Батмөнх',
  'Дэлгэрмаа', 'Эрдэнэ', 'Ганзориг', 'Аюуш', 'Мандах', 'Сэлэнгэ', 'Түмэн',
  'Уянга', 'Хишиг', 'Чинбат', 'Ялалт', 'Жаргал', 'Идэр', 'Лхагва', 'Мөрөн',
  'Namuun', 'Одбаяр', 'Пүрэв', 'Ринчин', 'Сайхан', 'Тамир', 'Уран', 'Хүслэн',
  'Цолмон', 'Чимэг', 'Шижир', 'Энхжин', 'Ялгуун', 'Анар', 'Болор', 'Ганаа',
  'Дулмаа', 'Есүй', 'Жавхлан', 'Зул', 'Ирээдүй', 'Хонгор', 'Мишээл',
];

/** Тодорхойлогдсон (deterministic) санамсаргүй — seed бүрд ижил үр дүн. */
class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 0x100000000;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

const rng = new Rng(20260824);

/** Локал (UB) огноо/цагаас UTC Date. */
function ub(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m, d, h - TZ_OFFSET_H, min, 0));
}

function endOfUbDay(date: Date): Date {
  const local = new Date(date.getTime() + TZ_OFFSET_H * 3_600_000);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      23 - TZ_OFFSET_H,
      59,
      59,
      999,
    ),
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('⛔ seed:demo нь production дээр ажиллахгүй');
  }

  await AppDataSource.initialize();
  const ds = AppDataSource;
  const now = new Date();

  // ── Цэвэрлэх (ажилтныг хөндөхгүй) ──
  console.log('Хуучин демо өгөгдлийг цэвэрлэж байна…');
  await ds.query(
    `TRUNCATE access_events, memberships, outbox, audit_log, locker_assignments, lockers RESTART IDENTITY CASCADE`,
  );
  await ds.query(`DELETE FROM members`);
  await ds.query(`DELETE FROM devices`);
  await ds.query(`ALTER SEQUENCE member_no_seq RESTART WITH 1001`);

  // ── Ажилтан ──
  const staffRepo = ds.getRepository(StaffUser);
  const pwd = await hash('winfit-demo-2026');
  for (const [email, name, role] of [
    ['manager@winfit.mn', 'Оюунаа', Role.MANAGER],
    ['reception2@winfit.mn', 'Дэлгэр', Role.RECEPTION],
  ] as const) {
    if (!(await staffRepo.findOne({ where: { email } }))) {
      await staffRepo.save(
        staffRepo.create({ email, name, role, passwordHash: pwd, mustChangePassword: false }),
      );
    }
  }

  // ── Терминал ──
  const device = await ds.getRepository(Device).save(
    ds.getRepository(Device).create({
      name: 'Гол хаалга',
      serial: 'DS-K1T320MFX-STUB-001',
      model: 'DS-K1T320MFX',
      ip: '192.168.1.64',
      doorNo: 1,
      firmware: 'V0.0.0-stub',
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
  // Богино багц илүү түгээмэл — бодит байдалд ойр жин.
  const pkgWeights = [0.55, 0.25, 0.13, 0.07];

  // ── Гишүүд ──
  console.log('Гишүүд үүсгэж байна…');
  const memberRepo = ds.getRepository(Member);
  const msRepo = ds.getRepository(Membership);
  const members: Member[] = [];

  for (let i = 0; i < 60; i++) {
    const seq = await ds.query<{ nextval: string }[]>(`SELECT nextval('member_no_seq')`);
    const joinedDaysAgo = rng.int(5, 200);
    const createdAt = new Date(now.getTime() - joinedDaysAgo * 86_400_000);
    members.push(
      memberRepo.create({
        memberNo: Number(seq[0].nextval),
        name: `${FIRST[i % FIRST.length]}${i >= FIRST.length ? ` ${Math.floor(i / FIRST.length) + 1}` : ''}`,
        phone: String(88000000 + i * 1237).slice(0, 8),
        email: rng.chance(0.4) ? `member${i}@example.mn` : null,
        status: MemberStatus.LEAD,
        payToken: randomBytes(24).toString('base64url'),
        faceEnrolled: true,
        faceEnrolledAt: createdAt,
        hikSyncedAt: createdAt,
        createdAt,
      }),
    );
  }
  await memberRepo.save(members);

  // ── Гишүүнчлэл (худалдан авалтын түүх) ──
  console.log('Гишүүнчлэлийн түүх үүсгэж байна…');
  const memberships: Membership[] = [];
  let idem = 0;

  // Сүүлийн 5 гишүүн — саяхан бүртгүүлсэн, ХАРААХАН ТӨЛӨӨГҮЙ (`lead`).
  // Dashboard дээрх «царай бүртгээгүй» ба «шинэ бүртгэл» хайрцаг дүүрнэ.
  const leads = new Set(members.slice(-5).map((m) => m.id));

  for (const m of members) {
    if (leads.has(m.id)) continue;
    // Гишүүн бүрийн зан төлөв: тогтмол сунгадаг / хааяа / нэг удаа ирээд алга
    const loyalty = rng.next(); // 0..1
    const renewals = loyalty > 0.75 ? rng.int(4, 7) : loyalty > 0.35 ? rng.int(2, 3) : rng.int(0, 1);

    let cursor = new Date(m.createdAt);
    let ends: Date | null = null;

    for (let r = 0; r <= renewals; r++) {
      if (cursor.getTime() > now.getTime()) break;
      // Багц сонгох (жинтэй)
      const roll = rng.next();
      let acc = 0;
      let pkg = packages[0];
      for (let p = 0; p < packages.length; p++) {
        acc += pkgWeights[p];
        if (roll <= acc) { pkg = packages[p]; break; }
      }

      const base = ends && ends > cursor ? ends : cursor;
      ends = endOfUbDay(new Date(base.getTime() + pkg.days * 86_400_000));
      const source = rng.chance(0.55) ? MembershipSource.CASH : MembershipSource.BONUM;

      memberships.push(
        msRepo.create({
          memberId: m.id,
          packageId: pkg.id,
          packageName: pkg.name,
          days: pkg.days,
          amount: pkg.price,
          source,
          startsAt: base,
          endsAt: ends,
          idempotencyKey: `demo-${++idem}-${m.memberNo}`,
          createdAt: cursor,
        }),
      );

      // Дараагийн сунгалт: хугацаа дуусахаас өмнө эсвэл хэсэг хугацааны дараа
      const gap = rng.chance(0.7) ? rng.int(-3, 2) : rng.int(3, 25);
      cursor = new Date(ends.getTime() + gap * 86_400_000);
    }

    m.accessEndsAt = ends;
    if (!ends) {
      m.status = MemberStatus.LEAD;
      m.faceEnrolled = rng.chance(0.5);
    } else if (ends.getTime() > now.getTime()) {
      m.status = MemberStatus.ACTIVE;
    } else {
      m.status = MemberStatus.EXPIRED;
    }
  }

  // Хэдэн онцгой тохиолдол — dashboard-ийн бүх хайрцаг дүүрэн харагдана.
  const active = members.filter((m) => m.status === MemberStatus.ACTIVE);
  for (const m of active.slice(0, 3)) m.status = MemberStatus.SUSPENDED;
  for (const m of active.slice(3, 6)) {
    // Удахгүй дуусах — 2..6 хоног
    m.accessEndsAt = endOfUbDay(new Date(now.getTime() + rng.int(2, 6) * 86_400_000));
  }
  // Шинэ бүртгэлүүд: саяхан үүссэн, зарим нь царайгаа хараахан уншуулаагүй.
  let leadIdx = 0;
  for (const m of members) {
    if (!leads.has(m.id)) continue;
    m.status = MemberStatus.LEAD;
    m.accessEndsAt = null;
    m.createdAt = new Date(now.getTime() - rng.int(0, 4) * 86_400_000);
    m.faceEnrolled = leadIdx++ >= 3; // 3 нь царайгаа бүртгүүлээгүй
    m.faceEnrolledAt = m.faceEnrolled ? m.createdAt : null;
    m.hikSyncedAt = m.createdAt;
  }
  // Хоёрт нь синкийн алдаа
  for (const m of active.slice(6, 8)) {
    m.hikSyncError = 'Терминал хариу өгсөнгүй (stub: түр зуурын алдаа)';
  }

  await msRepo.save(memberships, { chunk: 200 });
  await memberRepo.save(members, { chunk: 200 });

  // ── Ирц (90 хоног) ──
  console.log('Ирцийн бүртгэл үүсгэж байна…');
  const events: Partial<AccessEvent>[] = [];
  const DAYS = 90;

  for (const m of members) {
    if (!m.accessEndsAt) continue;
    // Ирэх давтамж: 7 хоногт хэдэн удаа
    const perWeek = rng.chance(0.25) ? rng.int(5, 6) : rng.chance(0.5) ? rng.int(3, 4) : rng.int(1, 2);
    // Ирдэг цагийн хэв маяг: өглөөний хүн / оройн хүн
    const morning = rng.chance(0.42);

    for (let d = DAYS; d >= 0; d--) {
      const day = new Date(now.getTime() - d * 86_400_000);
      // Тухайн өдөр эрхтэй байсан эсэх
      const hadAccess = m.accessEndsAt && day <= m.accessEndsAt && day >= m.createdAt;
      if (!hadAccess) continue;

      const dow = new Date(day.getTime() + TZ_OFFSET_H * 3_600_000).getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const p = (perWeek / 7) * (weekend ? 0.45 : 1.15);
      if (!rng.chance(p)) continue;

      const local = new Date(day.getTime() + TZ_OFFSET_H * 3_600_000);
      const hour = morning
        ? rng.int(6, 9)
        : rng.chance(0.75)
          ? rng.int(18, 21)
          : rng.int(12, 16);
      const at = ub(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate(),
        hour,
        rng.int(0, 59),
      );
      if (at > now) continue;

      events.push({
        deviceId: device.id,
        memberId: m.id,
        employeeNo: m.memberNo,
        eventAt: at,
        granted: true,
        reason: AccessReason.OK,
        verifyMode: 'face',
        dedupeKey: createHash('sha1')
          .update(`${device.id}|${m.memberNo}|${Math.floor(at.getTime() / 1000)}`)
          .digest('hex')
          .slice(0, 40),
      });

      // Заримдаа гарахдаа дахин уншуулна — «өдөрт 1 ирц» дүрмийг шалгах өгөгдөл
      if (rng.chance(0.35)) {
        const out = new Date(at.getTime() + rng.int(45, 110) * 60_000);
        if (out < now) {
          events.push({
            deviceId: device.id,
            memberId: m.id,
            employeeNo: m.memberNo,
            eventAt: out,
            granted: true,
            reason: AccessReason.OK,
            verifyMode: 'face',
            dedupeKey: createHash('sha1')
              .update(`${device.id}|${m.memberNo}|${Math.floor(out.getTime() / 1000)}`)
              .digest('hex')
              .slice(0, 40),
          });
        }
      }
    }

    // Хугацаа дууссаны дараа мэдэлгүй ирсэн — татгалзсан эвент
    if (m.status === MemberStatus.EXPIRED && rng.chance(0.45)) {
      const at = new Date(m.accessEndsAt.getTime() + rng.int(1, 10) * 86_400_000);
      if (at < now) {
        events.push({
          deviceId: device.id,
          memberId: m.id,
          employeeNo: m.memberNo,
          eventAt: at,
          granted: false,
          reason: AccessReason.EXPIRED,
          verifyMode: 'face',
          dedupeKey: createHash('sha1')
            .update(`${device.id}|${m.memberNo}|${Math.floor(at.getTime() / 1000)}`)
            .digest('hex')
            .slice(0, 40),
        });
      }
    }
  }

  const evRepo = ds.getRepository(AccessEvent);
  await evRepo.save(events as AccessEvent[], { chunk: 500 });

  // Сүүлийн ирэлтийн кэш
  await ds.query(`
    UPDATE members m SET last_visit_at = s.last
    FROM (SELECT member_id, MAX(event_at) AS last FROM access_events
          WHERE granted GROUP BY member_id) s
    WHERE m.id = s.member_id`);

  // ── Шүүгээ ──
  // Эрэгтэй/эмэгтэй өрөөний дугаарлалт ТУСДАА — хоёуланд №1..N байна.
  console.log('Шүүгээ үүсгэж байна…');
  const lockerRepo = ds.getRepository(Locker);
  const asgRepo = ds.getRepository(LockerAssignment);
  const lockers: Locker[] = [];
  for (const [zone, count] of [['Эрэгтэй', 40], ['Эмэгтэй', 32]] as const) {
    for (let n = 1; n <= count; n++) {
      lockers.push(
        lockerRepo.create({
          zone,
          number: n,
          // Хоёр шүүгээ эвдэрсэн — «хаалттай» төлөв харагдана.
          active: !(zone === 'Эрэгтэй' && (n === 13 || n === 27)),
          note:
            zone === 'Эрэгтэй' && (n === 13 || n === 27) ? 'Түгжээ эвдэрсэн' : null,
        }),
      );
    }
  }
  await lockerRepo.save(lockers);

  const activeNow = members.filter((m) => m.status === MemberStatus.ACTIVE);
  const assignments: LockerAssignment[] = [];
  const usedLockers = new Set<string>();
  const usedMembers = new Set<string>();

  const takeLocker = (zone: string): Locker | undefined => {
    const pool = lockers.filter(
      (l) => l.zone === zone && l.active && !usedLockers.has(l.id),
    );
    if (!pool.length) return undefined;
    const l = rng.pick(pool);
    usedLockers.add(l.id);
    return l;
  };

  // Өдрийн түлхүүр — одоо заалд байгаа хүмүүс
  for (let i = 0; i < 9; i++) {
    const m = rng.pick(activeNow.filter((x) => !usedMembers.has(x.id)));
    if (!m) break;
    const l = takeLocker(rng.chance(0.55) ? 'Эрэгтэй' : 'Эмэгтэй');
    if (!l) break;
    usedMembers.add(m.id);
    assignments.push(
      asgRepo.create({
        lockerId: l.id,
        lockerZone: l.zone,
        lockerNumber: l.number,
        memberId: m.id,
        type: LockerAssignmentType.DAILY,
        issuedAt: new Date(now.getTime() - rng.int(10, 180) * 60_000),
        amount: '0',
      }),
    );
  }

  // Түрээс — 6 идэвхтэй, 2 хугацаа хэтэрсэн
  for (let i = 0; i < 8; i++) {
    const m = rng.pick(activeNow.filter((x) => !usedMembers.has(x.id)));
    if (!m) break;
    const l = takeLocker(rng.chance(0.5) ? 'Эрэгтэй' : 'Эмэгтэй');
    if (!l) break;
    usedMembers.add(m.id);
    const overdue = i >= 6;
    const issuedAt = new Date(
      now.getTime() - (overdue ? rng.int(40, 70) : rng.int(1, 25)) * 86_400_000,
    );
    assignments.push(
      asgRepo.create({
        lockerId: l.id,
        lockerZone: l.zone,
        lockerNumber: l.number,
        memberId: m.id,
        type: LockerAssignmentType.RENTAL,
        issuedAt,
        dueAt: endOfUbDay(new Date(issuedAt.getTime() + 30 * 86_400_000)),
        amount: '30000',
        source: 'cash',
      }),
    );
  }

  // Буцаагдсан түүх (өнгөрсөн 30 хоног)
  for (let i = 0; i < 40; i++) {
    const m = rng.pick(members);
    const zone = rng.chance(0.55) ? 'Эрэгтэй' : 'Эмэгтэй';
    const pool = lockers.filter((l) => l.zone === zone && l.active);
    const l = rng.pick(pool);
    const issuedAt = new Date(now.getTime() - rng.int(1, 30) * 86_400_000);
    assignments.push(
      asgRepo.create({
        lockerId: l.id,
        lockerZone: l.zone,
        lockerNumber: l.number,
        memberId: m.id,
        type: LockerAssignmentType.DAILY,
        issuedAt,
        returnedAt: new Date(issuedAt.getTime() + rng.int(50, 150) * 60_000),
        amount: '0',
      }),
    );
  }
  await asgRepo.save(assignments, { chunk: 100 });

  // ── Товч ──
  const stat = await ds.query<Record<string, string>[]>(`
    SELECT
      (SELECT count(*) FROM members) AS members,
      (SELECT count(*) FROM members WHERE status='active') AS active,
      (SELECT count(*) FROM members WHERE status='expired') AS expired,
      (SELECT count(*) FROM members WHERE status='suspended') AS suspended,
      (SELECT count(*) FROM memberships) AS memberships,
      (SELECT coalesce(sum(amount),0) FROM memberships) AS revenue,
      (SELECT count(*) FROM access_events) AS events,
      (SELECT count(*) FROM lockers) AS lockers,
      (SELECT count(*) FROM locker_assignments WHERE returned_at IS NULL) AS keys_out,
      (SELECT count(*) FROM locker_assignments
        WHERE returned_at IS NULL AND due_at < now()) AS overdue`);
  const s = stat[0];
  console.log('\n✓ Демо өгөгдөл бэлэн');
  console.log(`   Гишүүн      : ${s.members} (идэвхтэй ${s.active}, дууссан ${s.expired}, зогссон ${s.suspended})`);
  console.log(`   Гишүүнчлэл  : ${s.memberships} худалдан авалт, нийт ${Number(s.revenue).toLocaleString()}₮`);
  console.log(`   Ирц         : ${s.events} эвент (90 хоног)`);
  console.log(`   Шүүгээ      : ${s.lockers} (гарсан ${s.keys_out}, хэтэрсэн ${s.overdue})`);
  console.log(`   Ажилтан     : manager@winfit.mn / reception2@winfit.mn — нууц үг: winfit-demo-2026`);

  await ds.destroy();
}

main().catch((e: unknown) => {
  console.error('✗ Seed амжилтгүй:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
