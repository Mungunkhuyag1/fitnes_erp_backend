import { HttpException, HttpStatus } from '@nestjs/common';

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
/**
 * ⚠ `HttpException`-ээс удамшина. Энэ алдаа нь outbox-оос ГАДНА
 * controller-ээс ч шидэгддэг (жишээ нь админ Loopy-гийн программуудыг
 * татах үед). Энгийн `Error` байхад Nest нь түүнийг «Internal server
 * error» болгон хувиргаж, ЯАГААД гэдгийг нуудаг байв — админ юу
 * буруу болсныг мэдэхгүй суудаг.
 *
 * `502` нь үнэн: алдаа ЭНД биш, ГАДНАД гарсан.
 */
export class PermanentError extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.BAD_GATEWAY);
    this.name = 'PermanentError';
  }
}
