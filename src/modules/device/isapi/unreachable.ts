import { DeviceUnreachableError } from '../device.gateway';

/**
 * «Терминал руу ХҮРСЭНГҮЙ» гэдгийг таних.
 *
 * ★ ЯАГААД ТУСДАА ТАНИХ ХЭРЭГТЭЙ ВЭ
 *
 * Терминал нь Cloudflare тунелээр дамждаг (`hik.winfit.mn`). Тунел
 * унавал Cloudflare нь ӨӨРИЙН алдааны ХУУДСЫГ буцаана — 530 статус,
 * бүтэн HTML. Урьд нь үүнийг ISAPI-ийн хариу гэж үзэж:
 *
 *     IsapiError: ISAPI 530: <!doctype html> ...
 *
 * гээд 6 КБ HTML-ийг алдааны мессеж болгон дэлгэц рүү шиднэ. Ажилтан
 * «Internal server error» хараад юу болсныг огт мэдэхгүй — терминал
 * эвдэрсэн үү, тунел салсан уу, WinFit-д алдаа гарсан уу.
 *
 * ★ ТАНИХ ДҮРЭМ
 *
 * ISAPI нь ҮРГЭЛЖ XML эсвэл JSON буцаадаг. HTML ирсэн бол тэр нь
 * терминалынх БИШ — хооронд байгаа ямар нэг зүйл хариулсан гэсэн үг.
 * Энэ нь статусаас ч найдвартай шинж тэмдэг.
 */

/** Cloudflare тунелийн статусууд ба тэдгээрийн утга. */
const STATUS_HINT: Record<number, string> = {
  // 1033 — cloudflared ажиллахгүй эсвэл Cloudflare түүнийг олохгүй байна.
  530: 'тунел ажиллахгүй байна',
  502: 'тунел байгаа ч терминал хариу өгөхгүй байна',
  504: 'терминал хэт удаан хариулж байна',
  521: 'терминал холболтыг татгалзав',
  522: 'терминал руу холбогдох хугацаа хэтэрлээ',
  523: 'терминал руу зам олдсонгүй',
};

/** Хариу нь ТЕРМИНАЛЫНХ биш бол шалтгааныг, мөн бол `null`. */
export function unreachableReason(
  status: number,
  body: string,
): string | null {
  const head = body.slice(0, 400);

  // Cloudflare Access нь нэвтрэх хуудас руу шидэж болно.
  if (status === 403 && /cloudflare/i.test(head)) {
    return 'Cloudflare Access татгалзав — service token хүчингүй байж магадгүй';
  }

  const hint = STATUS_HINT[status];
  if (hint) return hint;

  /*
   * ⚠ Статус нь 200 ч байсан HTML ирвэл терминал БИШ.
   *
   * Нэвтрэх портал, прокси, ISP-ийн саатуулагч бүгд 200-гаар HTML
   * буцаадаг. Үүнийг ISAPI гэж задлавал «талбар олдсонгүй» гэсэн
   * ойлгомжгүй алдаа руу хөтөлнө.
   */
  if (/^\s*(<!doctype html|<html)/i.test(head)) {
    return 'терминалын хариу биш, HTML хуудас ирлээ';
  }

  return null;
}

/** Хүрээгүй бол шиднэ. Хүрсэн бол юу ч хийхгүй. */
export function assertReachable(status: number, body: string): void {
  const reason = unreachableReason(status, body);
  if (reason) throw new DeviceUnreachableError(reason, status);
}

/**
 * Сүлжээний доголдлыг (fetch унасан, хугацаа хэтэрсэн) таних.
 *
 * `fetch` нь эдгээрт `TypeError: fetch failed` эсвэл `TimeoutError`
 * шиддэг — аль нь ч терминалын хариу биш.
 */
export function networkReason(e: unknown): string | null {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  const name = err?.name ?? '';
  const msg = err?.message ?? '';

  if (name === 'TimeoutError') return 'хариу өгөх хугацаа хэтэрлээ';
  if (name === 'AbortError') return null; // Зориуд цуцалсан — алдаа биш.

  const code = err?.cause?.code;
  if (code === 'ENOTFOUND') return 'хаяг олдсонгүй (DNS)';
  if (code === 'ECONNREFUSED') return 'холболтыг татгалзав';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'сүлжээгээр хүрэхгүй байна';
  if (code === 'ECONNRESET') return 'холболт тасарлаа';
  if (code === 'ETIMEDOUT') return 'холбогдох хугацаа хэтэрлээ';
  if (/fetch failed/i.test(msg)) return `холбогдсонгүй${code ? ` (${code})` : ''}`;

  return null;
}
