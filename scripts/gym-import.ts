/**
 * ЗААЛАН ДЭЭР — терминалаас өгөгдлийг татах НЭГ КОМАНД.
 *
 *   npx ts-node scripts/gym-import.ts
 *
 * ★ ЗӨВХӨН УНШИНА. Терминал руу ямар ч бичилт явуулахгүй:
 *   `diagnose`, `pull-all`, `acs-backfill`, `diff` дөрвүүлээ уншдаг
 *   үйлдэл. Тулгалтыг ЗАСДАГ `device-audit` (POST)-ыг энэ скрипт
 *   ЗОРИУДААР дууддаггүй.
 *
 * ★ ЯАГААД СКРИПТ ВЭ
 *   `pull-all` ба `acs-backfill` нь дашбордод товчгүй ADMIN-only POST.
 *   Заалан дээр дарах юм байхгүй. Мөн 30 хоногийн ирц нь өдрөөр
 *   хэсэглэн 30 хүсэлт явуулдаг тул хөтчид timeout болж магадгүй —
 *   энд хугацааг уртаар өгсөн.
 *
 * Нэвтрэх мэдээллийг орчноос авна (терминал дээр бичихгүй):
 *   WINFIT_API   (заавал биш, анхдагч https://api.winfit.mn)
 *   WINFIT_EMAIL WINFIT_PASSWORD
 * эсвэл .env.railway дотроос ADMIN_EMAIL= / ADMIN_PASSWORD= уншина.
 */
import * as fs from 'fs';

const API = process.env.WINFIT_API ?? 'https://api.winfit.mn';

function fromEnvFile(key: string): string | undefined {
  try {
    return fs
      .readFileSync('.env.railway', 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`))
      ?.slice(key.length + 1)
      .trim();
  } catch {
    return undefined;
  }
}

const EMAIL = process.env.WINFIT_EMAIL ?? fromEnvFile('ADMIN_EMAIL');
const PASSWORD = process.env.WINFIT_PASSWORD ?? fromEnvFile('ADMIN_PASSWORD');

let token = '';

async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 300_000,
): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${path} — ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

const h = (s: string) => console.log(`\n── ${s} ──`);

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error(
      '✗ Нэвтрэх мэдээлэл алга.\n' +
        '  WINFIT_EMAIL=... WINFIT_PASSWORD=... npx ts-node scripts/gym-import.ts',
    );
    process.exit(1);
  }
  console.log(`API: ${API}`);

  h('1/5 Нэвтрэх');
  token = (await call('POST', '/api/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  })).accessToken;
  console.log('  ✓');

  // ⚠ ХОЛБОЛТЫГ ЭХЛЭЭД БАТЛАНА. Туннель унтарсан эсвэл HIK_HOST
  // хуучин бол `pull-all` нь «0 хүн» гэж БҮТЭЛГҮЙТЭХГҮЙГЭЭР буцаж
  // мэдэгдэхгүй өнгөрөх эрсдэлтэй.
  h('2/5 Терминалын холболт');
  const d = await call('GET', '/api/devices/diagnose', undefined, 60_000);
  console.log(JSON.stringify(d, null, 2).slice(0, 1200));
  const blob = JSON.stringify(d);
  if (!blob.includes('DS-K1T320MWX')) {
    console.error(
      '\n✗ DS-K1T320MWX олдсонгүй. Туннель/HIK_HOST-ыг шалга. ЗОГСЛОО.',
    );
    process.exit(1);
  }
  console.log('  ✓ DS-K1T320MWX');

  h('3/5 Гишүүдийг татах (pull-all)');
  const p = await call('POST', '/api/sync/run/device-audit/pull-all');
  console.log(
    `  терминал дээр ${p.deviceTotal} · шинэ ${p.created} · байсан ${p.skipped}` +
      (p.relinked !== undefined ? ` · өнчин ирц холбов ${p.relinked}` : ''),
  );

  h('4/5 Түүхэн ирц');
  for (const days of [7, 30]) {
    const r = await call('POST', '/api/sync/run/acs-backfill', { days });
    console.log(`  ${days} хоног → ${JSON.stringify(r)}`);
  }

  h('5/5 Тулгалт (diff)');
  const diff = await call('GET', '/api/sync/run/device-audit/diff');
  const n = (k: string) => (Array.isArray(diff?.[k]) ? diff[k].length : diff?.[k]);
  console.log(JSON.stringify(diff, null, 2).slice(0, 2000));
  console.log(
    `\n  missing=${n('missing')} extras=${n('extras')} drift=${n('drift')} nameDiff=${n('nameDiff')}`,
  );
  console.log(
    '\n  ⚠ nameDiff олон байх нь ХЭВИЙН (бүртгэлийн дугаар нэрнээс салгагдсан).\n' +
      '  ⚠ drift>0 байвал «Тулгаж засах» товчийг БҮҮ дар — бичилт хаалттай\n' +
      '    тул алдаа хуримтлагдана. Надад хэлээрэй.',
  );

  console.log('\n✓ Дууслаа. Одоо: pkill cloudflared');
})().catch((e) => {
  console.error('\n✗', e.message);
  process.exit(1);
});
