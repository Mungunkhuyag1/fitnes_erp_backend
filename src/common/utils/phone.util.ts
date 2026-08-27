/**
 * Утасны дугаарыг нормчилно — DB-д ҮРГЭЛЖ 8 оронтой цэвэр тоогоор хадгална.
 *
 * Хүлээж авах хэлбэрүүд: `+976 9911-2233`, `976-99112233`, `99 11 22 33`,
 * `(+976) 99112233` → бүгд `99112233` болно.
 *
 * Утас нь Loopy-тэй холбогдох ГОЛ түлхүүр (docs/01 §4) тул хоёр талд ижил
 * дүрмээр нормчлох ёстой — Loopy-гийн `normalizePhone` мөн 8 орон авдаг.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/\D/g, '');
  // Улсын код (976) урдаа байвал хасна — 976 + 8 орон = 11 орон.
  if (digits.length === 11 && digits.startsWith('976')) digits = digits.slice(3);
  // Зарим үед 00976 гэж бичдэг.
  if (digits.length === 13 && digits.startsWith('00976')) digits = digits.slice(5);
  return digits.length === 8 ? digits : null;
}

/** Дугаар хүчинтэй эсэх (Монголын гар утас 8 орон, 5–9-өөр эхэлнэ). */
export function isValidPhone(input: string | null | undefined): boolean {
  const p = normalizePhone(input);
  return !!p && /^[5-9]\d{7}$/.test(p);
}

/**
 * Харуулахад далдална — `/pay` хуудасны 2-р түвшинд (docs/01 §6.6).
 * `99112233` → `99••2233`
 */
export function maskPhone(phone: string): string {
  return phone.length === 8 ? `${phone.slice(0, 2)}••${phone.slice(4)}` : phone;
}

/**
 * Нэрийг далдална — `/pay`-ийн 1-р түвшинд «зөв хүн мөн үү» гэдгийг
 * батлахад хангалттай хэмжээгээр.
 *
 *   `Наранцэцэг Сүх` → `Нар••••••• Сү•`
 *   `Батаа`          → `Бат••`
 *
 * ⚠ ҮГ ТУС БҮРИЙГ ТУСАД НЬ далдална. Бүтэн мөрийг нэг гэж үзвэл
 * `Н•••х` болж, ХОЁР үгтэй нэр нэг үг мэт харагдана — өөрийн нэрээ
 * ч танихад хэцүү.
 *
 * Гишүүний бүрэн нэрийг утасны дугаараар хэн ч харах ёсгүй тул үг бүрийн
 * сүүлийн ХАМГИЙН БАГА нэг үсэг үргэлж далдлагдана.
 */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 1) return word;
      if (word.length === 2) return `${word[0]}•`;
      // Эхний 3 үсэг ил, үлдсэн нь цэг. Богино үг дээр ч дор хаяж нэг
      // үсэг далдлагдана.
      const shown = Math.min(3, word.length - 1);
      return word.slice(0, shown) + '•'.repeat(word.length - shown);
    })
    .join(' ');
}
