/**
 * Дахин оролдох УТГАГҮЙ алдаа.
 *
 * Жишээ: терминал `403` (эрхгүй), `404` (endpoint байхгүй), өгөгдөл буруу.
 * Ийм алдааг дахин илгээх нь зөвхөн лог бөглөнө — шууд `failed` болгож
 * dashboard дээр гаргана.
 *
 * Түр зуурын алдаа (timeout, сүлжээ, `5xx`) нь энгийн `Error` — backoff-оор
 * дахин оролдоно.
 */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}
