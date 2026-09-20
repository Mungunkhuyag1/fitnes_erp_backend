/**
 * Терминал дээрх нэрийг нэр ба регистр болгон салгах.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * Терминал нэг л текст талбартай тул заал хоёр зүйлийг НИЙЛҮҮЛЖ бичсэн
 * байдаг:
 *
 *   "Usukhbayar km78042019"   →   нэр "Usukhbayar", регистр "km78042019"
 *
 * 339 хэрэглэгчийн 180 нь ийм хэлбэртэй байсан (1787980000000 миграцийн
 * тэмдэглэл). Салгаж харуулахгүй бол ирцийн жагсаалт дээр регистр нь
 * нэрний хэсэг мэт харагдана.
 *
 * ⚠ Салгаж ЧАДААГҮЙ бол бүтнээр нь буцаана. Таамаглаж хагалбал регистргүй
 * хүний нэрийн сүүлчийн үг алга болно.
 */

/** Монгол регистр: 2 үсэг + 6–8 орон (заримд нэмэлт тэмдэгттэй). */
const REGISTER = /^(.*?)[\s]+([A-Za-zА-Яа-яӨөҮү]{2}\d{6,8}[a-z0-9]*)$/u;

export interface TerminalName {
  /** Регистр салгасны дараах нэр. Салгагдаагүй бол эх бичвэр. */
  name: string;
  /** Олдсон регистр, эс бөгөөс `null`. */
  register: string | null;
}

export function splitTerminalName(raw: unknown): TerminalName | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;

  const m = REGISTER.exec(value);
  if (!m) return { name: value, register: null };
  return { name: m[1].trim(), register: m[2] };
}
