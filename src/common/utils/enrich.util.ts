import type { DataSource } from 'typeorm';
import type { PlanMember } from './sync-plan.util';

export interface MemberBrief {
  id: string;
  name: string;
  memberNo: string;
}

/**
 * Гишүүдийн нэрийг ID-аар нь багцаар авах.
 *
 * ЯАГААД JOIN ХИЙХГҮЙ ВЭ: `leftJoin` + `addSelect` нь TypeORM-ийн
 * `getManyAndCount()`-ыг эвдэж, хуудаслалт буруу болдог (энэ төсөлд өмнө
 * тулгарсан алдаа). Тусад нь нэг асуулгаар авах нь найдвартай бөгөөд
 * хуудсанд 20 мөр байхад өртөг үл мэдэгдэхүйц.
 *
 * `uuid` биш утга ирвэл (жишээ нь шүүгээний `Эрэгтэй#12`) ЧИМЭЭГҮЙ
 * алгасна — дуудагч тал бүх төрлийн `entityId`-г дамжуулж болно.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadMembers(
  ds: DataSource,
  ids: (string | null | undefined)[],
): Promise<Map<string, MemberBrief>> {
  const clean = [...new Set(ids.filter((v): v is string => !!v && UUID.test(v)))];
  if (!clean.length) return new Map();
  const rows = await ds.query<{ id: string; name: string; member_no: string }[]>(
    `SELECT id, name, member_no FROM members WHERE id = ANY($1)`,
    [clean],
  );
  return new Map(
    rows.map((r) => [r.id, { id: r.id, name: r.name, memberNo: r.member_no }]),
  );
}

/**
 * Дарааллын ТӨЛӨВЛӨГӨӨ тооцоход хэрэгтэй бүрэн талбарууд.
 *
 * `loadMembers`-аас ТУСДАА: тэр нь аудит, жагсаалт зэрэг олон газарт
 * ашиглагддаг бөгөөд зөвхөн нэр хэрэгтэй. Тэнд нэмэлт багана татах нь
 * хуудас бүрд дэмий ачаалал.
 */
export async function loadPlanMembers(
  ds: DataSource,
  ids: (string | null | undefined)[],
): Promise<Map<string, PlanMember & MemberBrief>> {
  const clean = [...new Set(ids.filter((v): v is string => !!v && UUID.test(v)))];
  if (!clean.length) return new Map();
  const rows = await ds.query<
    {
      id: string;
      name: string;
      member_no: string;
      status: string;
      access_ends_at: Date | null;
      created_at: Date;
      phone: string | null;
      loopy_card_serial: string | null;
    }[]
  >(
    `SELECT id, name, member_no, status, access_ends_at, created_at,
            phone, loopy_card_serial
       FROM members WHERE id = ANY($1)`,
    [clean],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        memberNo: r.member_no,
        status: r.status,
        accessEndsAt: r.access_ends_at,
        createdAt: r.created_at,
        phone: r.phone,
        loopyCardSerial: r.loopy_card_serial,
      },
    ]),
  );
}

/** Ажилтнуудын нэрийг ID-аар нь багцаар авах. */
export async function loadStaff(
  ds: DataSource,
  ids: (string | null | undefined)[],
): Promise<Map<string, { id: string; name: string; email: string }>> {
  const clean = [...new Set(ids.filter((v): v is string => !!v && UUID.test(v)))];
  if (!clean.length) return new Map();
  const rows = await ds.query<{ id: string; name: string; email: string }[]>(
    `SELECT id, name, email FROM staff_users WHERE id = ANY($1)`,
    [clean],
  );
  return new Map(rows.map((r) => [r.id, r]));
}
