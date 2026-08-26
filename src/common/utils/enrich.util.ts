import type { DataSource } from 'typeorm';

export interface MemberBrief {
  id: string;
  name: string;
  memberNo: number;
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
  const rows = await ds.query<{ id: string; name: string; member_no: number }[]>(
    `SELECT id, name, member_no FROM members WHERE id = ANY($1)`,
    [clean],
  );
  return new Map(
    rows.map((r) => [r.id, { id: r.id, name: r.name, memberNo: r.member_no }]),
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
