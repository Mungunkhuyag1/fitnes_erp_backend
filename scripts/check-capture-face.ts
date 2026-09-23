import { captureBody, pickImagePart } from '../src/modules/device/isapi/isapi.client';

/**
 * `CaptureFaceData`-гийн хариу задлагчийн шалгалт.
 *
 * ★ ЯАГААД ТУСДАА ШАЛГАЛТ ВЭ
 *
 * Энэ нь БАЙТ огтолдог код: нэг байтаар хазайвал JPEG эвдэрч,
 * терминал «зураг таниагүй» гэж буцаана. Алдаа нь зөвхөн заалан дээр,
 * хүн терминалын өмнө зогсож байхад мэдэгдэнэ — тэнд засвар хийх нь
 * хамгийн үнэтэй.
 *
 * Бодит терминалын хариуг энд дуурайлгасан: `--boundary`, толгой,
 * хоосон мөр, бие, төгсгөлийн `\r\n`.
 */

let fails = 0;
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    fails++;
    console.log(`✗ ${name}${extra ? `\n   ${extra}` : ''}`);
  }
}

/** Жинхэнэ JPEG шиг — SOI … EOI. */
function jpeg(tag: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, tag, 0x00, 0xff, 0xd9]);
}

function part(headers: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`\r\n${headers}\r\n\r\n`, 'utf8'),
    body,
    Buffer.from('\r\n', 'utf8'),
  ]);
}

function multipart(boundary: string, parts: Buffer[]): Buffer {
  const sep = Buffer.from(`--${boundary}`, 'utf8');
  const out: Buffer[] = [];
  for (const p of parts) out.push(sep, p);
  out.push(sep, Buffer.from('--\r\n', 'utf8'));
  return Buffer.concat(out);
}

// ── Хүсэлтийн бие ──

ok(
  'captureBody(binary) нь dataType бичнэ',
  captureBody('binary').includes('<dataType>binary</dataType>'),
);
ok(
  'captureBody(null) нь dataType БИЧИХГҮЙ',
  !captureBody(null).includes('dataType'),
  captureBody(null),
);
ok(
  'captureBody нь нэрийн зайтай',
  captureBody(null).includes('xmlns="http://www.isapi.org/ver20/XMLSchema"'),
);

// ── Хариу задлах ──

const B = 'MIME_boundary_1A2B3C';
const visible = jpeg(0x11);
const infrared = jpeg(0x22);

ok(
  'нэг зурагтай multipart',
  pickImagePart(
    multipart(B, [part('Content-Type: image/jpeg\r\nContent-Length: 8', visible)]),
    `multipart/form-data; boundary=${B}`,
  )?.equals(visible) === true,
);

ok(
  'хоёр зурагтай — ЭХНИЙХИЙГ авна (инфра улаан биш)',
  pickImagePart(
    multipart(B, [
      part('Content-Type: image/jpeg', visible),
      part('Content-Type: image/jpeg', infrared),
    ]),
    `multipart/form-data; boundary=${B}`,
  )?.equals(visible) === true,
);

ok(
  'JSON хэсгийг алгасна',
  pickImagePart(
    multipart(B, [
      part('Content-Type: application/json', Buffer.from('{"captureProgress":100}', 'utf8')),
      part('Content-Type: image/jpeg', visible),
    ]),
    `multipart/form-data; boundary=${B}`,
  )?.equals(visible) === true,
);

ok(
  'Content-Type-гүй хэсгийг гарын үсгээр нь таана',
  pickImagePart(
    multipart(B, [part('Content-Disposition: form-data', visible)]),
    `multipart/form-data; boundary=${B}`,
  )?.equals(visible) === true,
);

ok(
  'хашилттай boundary',
  pickImagePart(
    multipart(B, [part('Content-Type: image/jpeg', visible)]),
    `multipart/form-data; boundary="${B}"; charset=utf-8`,
  )?.equals(visible) === true,
);

ok(
  'boundary байхгүй бол null',
  pickImagePart(multipart(B, [part('Content-Type: image/jpeg', visible)]), 'multipart/form-data') ===
    null,
);

ok(
  'зураггүй бол null',
  pickImagePart(
    multipart(B, [part('Content-Type: application/json', Buffer.from('{}', 'utf8'))]),
    `multipart/form-data; boundary=${B}`,
  ) === null,
);

/*
 * ⚠ ХАМГИЙН ЧУХАЛ ШАЛГАЛТ: биет дотор заагтай ТӨСТЭЙ байт байвал ч
 * эвдрэхгүй. JPEG нь дурын байт агуулдаг тул `--boundary`-гийн эхний
 * хэдэн тэмдэгт санамсаргүй таарах боломжтой.
 */
const tricky = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from('--MIME_boundary_1A2', 'utf8'), // бүтэн зааг БИШ
  Buffer.from([0xff, 0xd9]),
]);
ok(
  'бие дотор хагас зааг байсан ч бүтэн үлдэнэ',
  pickImagePart(
    multipart(B, [part('Content-Type: image/jpeg', tricky)]),
    `multipart/form-data; boundary=${B}`,
  )?.equals(tricky) === true,
);

console.log(fails ? `\n${fails} шалгалт унав` : '\nБүгд тэнцэв');
process.exit(fails ? 1 : 0);
