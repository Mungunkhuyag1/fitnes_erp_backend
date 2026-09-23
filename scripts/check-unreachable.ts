import {
  networkReason,
  unreachableReason,
} from '../src/modules/device/isapi/unreachable';

/**
 * «Терминал руу хүрсэнгүй» гэдгийг танихыг шалгана.
 *
 * ★ ЯАГААД ТУСДАА ШАЛГАЛТ ВЭ
 *
 * Энэ таних логик БУРУУ ажиллах хоёр арга бий бөгөөд хоёулаа муу:
 *
 *  • Хэт өгөөмөр — терминалын ЖИНХЭНЭ алдааг «холболт салсан» гэж
 *    нуувал ажилтан заалан дээрх компьютер рүү дэмий гүйнэ.
 *  • Хэт чанга — Cloudflare-ийн хуудсыг танихгүй бол 6 КБ HTML дахин
 *    дэлгэц рүү гарна.
 *
 * Тиймээс хоёр талыг нь хоёуланг шалгана.
 */

let fails = 0;
function ok(name: string, cond: boolean, got?: unknown): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    fails++;
    console.log(`✗ ${name}${got === undefined ? '' : `\n   got: ${String(got)}`}`);
  }
}

// ── Cloudflare тунел унасан (бодит хариу, лог дээрээс) ──

const CF_1033 =
  '<!doctype html>\n<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->\n' +
  '<head><title>Cloudflare Tunnel error | hik.winfit.mn | Cloudflare</title></head>' +
  '<body><h1>Error 1033</h1></body></html>';

ok('530 + Cloudflare хуудас → танина', unreachableReason(530, CF_1033) !== null);
ok('502 → танина', unreachableReason(502, CF_1033) !== null);
ok('504 → танина', unreachableReason(504, CF_1033) !== null);
ok('521/522/523 → танина',
  [521, 522, 523].every((s) => unreachableReason(s, CF_1033) !== null));
ok(
  '403 + Cloudflare → Access гэж танина',
  /Access/i.test(unreachableReason(403, CF_1033) ?? ''),
  unreachableReason(403, CF_1033),
);

/*
 * ⚠ ХАМГИЙН НАРИЙН ТОХИОЛДОЛ: статус 200 ч бие нь HTML.
 * Нэвтрэх портал, прокси, ISP-ийн саатуулагч бүгд ингэдэг.
 */
ok('200 ч HTML бие → танина', unreachableReason(200, CF_1033) !== null);

// ── ТЕРМИНАЛЫН жинхэнэ хариу — нуугдах ЁСГҮЙ ──

const XML_OK = '<?xml version="1.0" encoding="UTF-8"?><DeviceInfo><model>DS-K1T320MWX</model></DeviceInfo>';
const XML_ERR =
  '<?xml version="1.0" encoding="UTF-8"?><ResponseStatus><statusCode>6</statusCode>' +
  '<statusString>Invalid Content</statusString><errorMsg>dataType</errorMsg></ResponseStatus>';
const JSON_OK = '{"statusCode":1,"statusString":"OK"}';

ok('терминалын XML (200) → танихгүй', unreachableReason(200, XML_OK) === null);
ok('терминалын XML алдаа (400) → танихгүй', unreachableReason(400, XML_ERR) === null);
ok('терминалын JSON (200) → танихгүй', unreachableReason(200, JSON_OK) === null);
ok('терминалын 401 (digest challenge) → танихгүй', unreachableReason(401, '') === null);
ok(
  'терминалын 403 (Cloudflare-гүй) → танихгүй',
  unreachableReason(403, XML_ERR) === null,
  unreachableReason(403, XML_ERR),
);
ok('терминалын 500 → танихгүй', unreachableReason(500, XML_ERR) === null);

// ── Сүлжээний доголдол ──

const netErr = (code: string) =>
  Object.assign(new TypeError('fetch failed'), { cause: { code } });

ok('ENOTFOUND → танина', networkReason(netErr('ENOTFOUND')) !== null);
ok('ECONNREFUSED → танина', networkReason(netErr('ECONNREFUSED')) !== null);
ok('ETIMEDOUT → танина', networkReason(netErr('ETIMEDOUT')) !== null);
ok(
  'кодгүй fetch failed → танина',
  networkReason(new TypeError('fetch failed')) !== null,
);
ok(
  'TimeoutError → танина',
  networkReason(Object.assign(new Error('x'), { name: 'TimeoutError' })) !== null,
);

/*
 * ⚠ ЦУЦЛАЛТЫГ АЛДАА ГЭЖ ҮЗЭХГҮЙ. Ажилтан «Цуцлах» дарахад «терминалтай
 * холболт салсан» гэж хэлбэл худал мэдээлэл болж, тунелээ дэмий шалгана.
 */
ok(
  'AbortError (цуцлалт) → танихгүй',
  networkReason(Object.assign(new Error('aborted'), { name: 'AbortError' })) === null,
);
ok(
  'энгийн алдаа → танихгүй',
  networkReason(new Error('Гишүүн олдсонгүй')) === null,
);

console.log(fails ? `\n${fails} шалгалт унав` : '\nБүгд тэнцэв');
process.exit(fails ? 1 : 0);
