import 'dotenv/config';
import { randomBytes } from 'crypto';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { AccessEvent, AccessReason } from '../../modules/access/access-event.entity';
import { Gender } from '../../common/enums/gender.enum';
import { Member } from '../../modules/member/member.entity';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { AppDataSource } from '../data-source';

/**
 * Hikvision терминалын экспортоос гишүүдийг импортлох.
 *
 *   IMPORT_CONFIRM=true npm run import:device
 *   IMPORT_CONFIRM=true IMPORT_WIPE=true npm run import:device
 *
 * ⚠ `IMPORT_WIPE=true` нь ОДОО БАЙГАА гишүүд, ирц, төлбөр, шүүгээний
 * олголт, аудитыг УСТГАНА. Ажилтан, багц, шүүгээ, тохиргоо үлдэнэ.
 *
 * ★ ЯАГААД ТЕРМИНАЛААС ИМПОРТЛОХ ВЭ
 *
 * Ажиллаж буй фитнес 339 гишүүнтэй бөгөөд тэдгээр нь ЗӨВХӨН терминал
 * дээр байна. Гараар дахин оруулах нь боломжгүй.
 */

// ── Терминалын нэрээс регистр салгах ──
//
// Монгол регистр: 2 үсэг + 8 орон (заримд нэмэлт тэмдэгттэй).
// Терминал дээр «Boldkhuu ayu93110115» гэж нэрийн ард залгагдсан байдаг.
const REGISTER = /^(.*?)[\s]+([A-Za-zА-Яа-яӨөҮү]{2}\d{6,8}[a-z0-9]*)$/u;

/**
 * 5 жилээс урт эрх → АЖИЛТАН байх магадлалтай.
 *
 * ⚠ Энэ бол ТААМАГ. Терминал дээр бүлгийн мэдээлэл байдаггүй
 * (бүх 339 нь `groupId=1`). Тиймээс автоматаар ажилтан болгохгүй —
 * зөвхөн ТЭМДЭГЛЭЛД бичиж, хүн шийдэхэд хялбар болгоно.
 */
const STAFF_YEARS = 5;

interface DeviceUser {
  employeeNo: string;
  name?: string;
  gender?: string;
  userType?: string;
  Valid?: { enable?: boolean; beginTime?: string; endTime?: string };
  faceURL?: string;
  numOfFace?: number;
}

function newestExport(): string {
  const dir = join(process.cwd(), 'export');
  if (!existsSync(dir)) throw new Error('export/ хавтас алга — npm run export-device');
  const f = readdirSync(dir)
    .filter((x) => x.startsWith('device-') && x.endsWith('.json'))
    .sort();
  if (!f.length) throw new Error('export/ дотор device-*.json алга');
  return join(dir, f[f.length - 1]);
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main(): Promise<void> {
  if (process.env.IMPORT_CONFIRM !== 'true') {
    console.error('⛔ IMPORT_CONFIRM=true гэж ил зөвшөөрнө үү.');
    process.exit(1);
  }

  const path = newestExport();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    users?: DeviceUser[];
    faces?: Record<string, boolean>;
    events?: Record<string, unknown>[];
  };
  const users = raw.users ?? [];
  const faces = raw.faces ?? {};
  console.log(`  Эх файл: ${path}`);
  console.log(`  ${users.length} хэрэглэгч, ${(raw.events ?? []).length} эвент\n`);

  await AppDataSource.initialize();
  const ds = AppDataSource;

  if (process.env.IMPORT_WIPE === 'true') {
    console.log('  Одоогийн гишүүдийн өгөгдлийг устгаж байна…');
    await ds.query(`
      TRUNCATE access_events, memberships, locker_assignments, invoices,
               outbox, audit_log, reminder_log RESTART IDENTITY CASCADE
    `);
    await ds.query(`DELETE FROM members`);
  }

  const memberRepo = ds.getRepository(Member);
  const now = new Date();
  const staffCut = new Date(now.getTime() + STAFF_YEARS * 365 * 86_400_000);

  let created = 0;
  let skipped = 0;
  let staffLike = 0;
  let noPhone = 0;
  const skippedNos: string[] = [];
  const numberMap = new Map<string, number>(); // терминал № → WinFit №

  for (const u of users) {
    // ⚠ `employeeNo` нь ТЕКСТ — «Adiya» гэсэн ч байсан. WinFit-ийн
    // `member_no` нь INTEGER тул хөрвөхгүйг алгасч, тайланд гаргана.
    const no = Number(u.employeeNo);
    if (!Number.isInteger(no) || no <= 0) {
      skipped++;
      skippedNos.push(String(u.employeeNo));
      continue;
    }

    const fullName = (u.name ?? '').trim() || `№${no}`;
    const m = REGISTER.exec(fullName);
    const name = m ? m[1].trim() : fullName;
    const register = m ? m[2].toUpperCase() : null;

    const endsAt = parseDate(u.Valid?.endTime);
    const beginAt = parseDate(u.Valid?.beginTime);
    const enabled = u.Valid?.enable !== false;

    // Төлөв нь ОГНООНООС гарна — терминалын `enable` нь хугацаа
    // дууссан ч `true` хэвээр үлддэг (245/339 дээр ажиглагдсан).
    let status: MemberStatus;
    if (!endsAt) status = MemberStatus.LEAD;
    else if (!enabled) status = MemberStatus.SUSPENDED;
    else status = endsAt > now ? MemberStatus.ACTIVE : MemberStatus.EXPIRED;

    const looksStaff = !!endsAt && endsAt > staffCut;
    if (looksStaff) staffLike++;
    noPhone++;

    const notes: string[] = [];
    if (looksStaff) notes.push('[ажилтан?]');
    if (u.userType === 'visitor') notes.push('[зочин]');
    notes.push(`терминалаас импортлов №${u.employeeNo}`);

    await memberRepo.save(
      memberRepo.create({
        memberNo: no,
        name,
        register,
        // ⚠ Терминалд утас ХАДГАЛАГДДАГГҮЙ. Loopy-тэй холбогдохын тулд
        // ажилтан гараар оруулах ёстой — dashboard анхааруулна.
        phone: null,
        email: null,
        gender:
          u.gender === 'male'
            ? Gender.MALE
            : u.gender === 'female'
              ? Gender.FEMALE
              : null,
        note: notes.join(' · '),
        status,
        accessEndsAt: endsAt,
        payToken: randomBytes(24).toString('base64url'),
        faceEnrolled: !!faces[String(no)],
        faceEnrolledAt: faces[String(no)] ? (beginAt ?? now) : null,
        // Терминал дээр аль хэдийн байгаа тул синк хийгдсэн гэж үзнэ —
        // эс бөгөөс `resync-all` 339 хэрэглэгчийг дахин бичих гэнэ.
        hikSyncedAt: now,
        createdAt: beginAt ?? now,
      }),
    );
    numberMap.set(String(u.employeeNo), no);
    created++;
  }

  // `member_no_seq`-ийг хамгийн их дугаараас ЦААШ шилжүүлнэ — эс бөгөөс
  // шинэ гишүүн үүсгэхэд импортлосонтой мөргөлдөнө.
  const [{ max }] = await ds.query<{ max: number }[]>(
    `SELECT COALESCE(MAX(member_no), 1000) AS max FROM members`,
  );
  await ds.query(`ALTER SEQUENCE member_no_seq RESTART WITH ${Number(max) + 1}`);

  // ── Ирц ──
  let events = 0;
  if (process.env.IMPORT_EVENTS !== 'false') {
    const { mapAcsEvent } = await import('../../modules/access/acs-event.mapper');
    const evRepo = ds.getRepository(AccessEvent);
    const byNo = new Map<number, string>();
    for (const m of await memberRepo.find({ select: { id: true, memberNo: true } })) {
      byNo.set(m.memberNo, m.id);
    }
    for (const e of raw.events ?? []) {
      const mapped = mapAcsEvent(e);
      if (!mapped || mapped.employeeNo === null) continue;
      const memberId = byNo.get(mapped.employeeNo) ?? null;
      await evRepo
        .createQueryBuilder()
        .insert()
        .into(AccessEvent)
        .values({
          memberId,
          employeeNo: mapped.employeeNo,
          eventAt: mapped.eventAt,
          granted: mapped.granted && memberId !== null,
          reason: memberId ? AccessReason.OK : AccessReason.UNKNOWN_MEMBER,
          verifyMode: mapped.verifyMode,
          raw: mapped.raw as never,
          // Импортод давхардлыг агуулгаар шүүнэ — дахин ажиллуулахад
          // ижил мөр давхардахгүй.
          dedupeKey: `import:${mapped.employeeNo}:${Math.floor(mapped.eventAt.getTime() / 1000)}`,
        })
        .orIgnore()
        .execute();
      events++;
    }
  }

  console.log('  ─────────────────────────────────────');
  console.log(`  үүсгэсэн гишүүн   : ${created}`);
  console.log(`  алгассан (№ тоо биш): ${skipped}${skipped ? ` → ${skippedNos.join(', ')}` : ''}`);
  console.log(`  регистртэй        : ${users.filter((u) => REGISTER.test((u.name ?? '').trim())).length}`);
  console.log(`  «ажилтан?» тэмдэгтэй: ${staffLike}`);
  console.log(`  ⚠ УТАСГҮЙ         : ${noPhone}  — Loopy холбогдохгүй`);
  console.log(`  ирц               : ${events}`);
  console.log(`  дараагийн №       : ${Number(max) + 1}`);

  await ds.destroy();
}

main().catch((e: unknown) => {
  console.error('✗ Импорт амжилтгүй:', e instanceof Error ? e.message : e);
  process.exit(1);
});
