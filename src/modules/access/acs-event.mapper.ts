import { AccessReason } from './access-event.entity';

/**
 * Hikvision-ы AcsEvent-ийг WinFit-ийн ирц болгон хөрвүүлэх.
 *
 * ⚠ Кодуудыг ГАРЫН АВЛАГААС биш, DS-K1T320MWX V3.5.2 дээрх 1,738 бодит
 * эвентийг шинжилж тодорхойлов (`docs/03-isapi-findings.md`). Өөр
 * firmware дээр ялгаатай байж болзошгүй тул шинэ код гарвал ЛОГ бичээд
 * алгасна — таамаглаж «зөвшөөрөв» гэж бүртгэхгүй.
 */

/** Хүн амжилттай нэвтэрсэн гэж үзэх minor кодууд. */
const GRANTED = new Set([
  75, // царайгаар танигдав — хамгийн түгээмэл (227/1738)
  104, // мөн танигдав; ирцийн бүртгэлтэй холбоотой хувилбар
  8, // картаар танигдав
]);

/** Танигдаагүй — хүний дугаар ирдэггүй, зөвхөн зураг үлддэг. */
const DENIED = new Set([
  76, // царай танигдсангүй (6/1738)
]);

export interface RawAcsEvent {
  major?: number;
  minor?: number;
  time?: string;
  employeeNoString?: string;
  employeeNo?: string | number;
  name?: string;
  currentVerifyMode?: string;
  serialNo?: number;
  doorNo?: number;
  pictureURL?: string;
  [k: string]: unknown;
}

export interface MappedEvent {
  employeeNo: number | null;
  eventAt: Date;
  granted: boolean;
  reason: AccessReason;
  verifyMode: string | null;
  pictureUrl: string | null;
  raw: Record<string, unknown>;
}

/** Танилтын аргыг товч нэрээр. */
function verifyMode(v?: string): string | null {
  if (!v || v === 'invalid') return null;
  // `cardOrfaceOrPw` гэх мэт олон боломжийг нэгтгэсэн утга ирдэг —
  // яг алиар нь орсныг терминал хэлдэггүй.
  if (/face/i.test(v)) return 'face';
  if (/card/i.test(v)) return 'card';
  if (/fp|finger/i.test(v)) return 'fp';
  return v.slice(0, 16);
}

/**
 * Нэг эвентийг хөрвүүлнэ. Ирцэд хамааралгүй бол `null`.
 *
 * Хаалганы мэдрэгч, алсын нэвтрэлт, эвдрэлийн дохио зэрэг нь нийт
 * эвентийн 77%-ийг эзэлдэг (1738-аас 1333) — тэдгээрийг ирц гэж
 * бүртгэвэл тайлан утгагүй болно.
 */
export function mapAcsEvent(e: RawAcsEvent): MappedEvent | null {
  const minor = e.minor;
  if (minor === undefined) return null;

  const isGranted = GRANTED.has(minor);
  const isDenied = DENIED.has(minor);
  if (!isGranted && !isDenied) return null; // төхөөрөмжийн эвент

  const t = e.time ? new Date(e.time) : null;
  if (!t || Number.isNaN(t.getTime())) return null;

  // `employeeNoString` нь текст — «Adiya» гэсэн ч байж болно. WinFit-ийн
  // `member_no` нь тоо тул хөрвөхгүйг алгасна (тэр хүн WinFit-д алга).
  const rawNo = e.employeeNoString ?? e.employeeNo;
  const num = rawNo !== undefined && rawNo !== null ? Number(rawNo) : NaN;
  const employeeNo = Number.isInteger(num) && num > 0 ? num : null;

  return {
    employeeNo,
    eventAt: t,
    granted: isGranted && employeeNo !== null,
    // Танигдаагүй бол `no_match`. Танигдсан ч WinFit-д гишүүн байхгүй
    // байж болно — түүнийг `ingest()` өөрөө шийднэ.
    reason: isDenied || employeeNo === null ? AccessReason.NO_MATCH : AccessReason.OK,
    verifyMode: verifyMode(e.currentVerifyMode),
    pictureUrl: typeof e.pictureURL === 'string' ? e.pictureURL : null,
    raw: e as Record<string, unknown>,
  };
}

/** Танигдаагүй minor кодуудыг нэг удаа лог бичихэд ашиглана. */
export function isKnownMinor(minor?: number): boolean {
  return minor !== undefined && (GRANTED.has(minor) || DENIED.has(minor));
}
