/**
 * Дэд сүлжээнээс Hikvision терминалыг ХАЙХ.
 *
 *   npm run find-device
 *   npm run find-device -- 192.168.1        # дэд сүлжээг гараар зааж
 *
 * ЯАГААД ХЭРЭГТЭЙ ВЭ: фитнест очиход терминалын IP-г хэн ч мэдэхгүй байх
 * нь элбэг (iVMS дээр хадгалагдсан, router-т хандах эрхгүй). `nmap` нь
 * ихэвчлэн суулгаагүй байдаг тул энгийн HTTP шалгалтаар олно.
 *
 * ⚠ НЭВТРЭХГҮЙ. Зөвхөн `/ISAPI/System/deviceInfo` рүү нэр/нууц үггүй
 * хүсэлт явуулна — Hikvision `401` + `WWW-Authenticate: Digest` буцаана.
 * Тэр хариу нь өөрөө «энэ бол Hikvision» гэсэн баталгаа бөгөөд буруу
 * нууц үгийн тоолуурыг ХӨДӨЛГӨХГҮЙ (5 удаад IP 30 минут блоклогддог).
 */
import { networkInterfaces } from 'os';

const TIMEOUT_MS = 1_500;

function localSubnet(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) {
        return n.address.split('.').slice(0, 3).join('.');
      }
    }
  }
  return null;
}

interface Hit {
  ip: string;
  hikvision: boolean;
  detail: string;
}

async function probe(ip: string): Promise<Hit | null> {
  const ctl = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const res = await fetch(`http://${ip}/ISAPI/System/deviceInfo`, {
      signal: ctl,
    });
    const auth = res.headers.get('www-authenticate') ?? '';
    const server = res.headers.get('server') ?? '';
    // 401 + Digest = ISAPI. 200 бол нээлттэй (ховор).
    const hik =
      /digest/i.test(auth) || /hikvision|app-webs|dnvrs/i.test(server);
    if (res.status === 401 || res.status === 200) {
      return {
        ip,
        hikvision: hik,
        detail: `HTTP ${res.status}${server ? ` · ${server}` : ''}${
          hik ? ' · ISAPI' : ''
        }`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const subnet = arg ?? localSubnet();
  if (!subnet) {
    console.error('✗ Дэд сүлжээ олдсонгүй. Гараар: npm run find-device -- 192.168.1');
    process.exit(1);
  }

  console.log(`Хайж байна: ${subnet}.1 – ${subnet}.254  (${TIMEOUT_MS}мс хүлээлт)\n`);

  const hits: Hit[] = [];
  // 32-оор багцалж явуулна — бүгдийг зэрэг явуулбал сүлжээ боогдоно.
  for (let start = 1; start <= 254; start += 32) {
    const batch: Promise<Hit | null>[] = [];
    for (let i = start; i < start + 32 && i <= 254; i++) {
      batch.push(probe(`${subnet}.${i}`));
    }
    for (const r of await Promise.all(batch)) if (r) hits.push(r);
    process.stdout.write(`  …${subnet}.${Math.min(start + 31, 254)}\r`);
  }

  console.log('\n');
  const hik = hits.filter((h) => h.hikvision);
  if (hik.length) {
    console.log('✓ Hikvision байж болзошгүй:');
    for (const h of hik) console.log(`    ${h.ip}   ${h.detail}`);
    console.log(`\n  .env дээр: HIK_HOST=${hik[0].ip}`);
  } else {
    console.log('✗ Hikvision олдсонгүй.');
  }

  const other = hits.filter((h) => !h.hikvision);
  if (other.length) {
    console.log(`\n  Веб хариу өгсөн бусад ${other.length} хаяг:`);
    for (const h of other) console.log(`    ${h.ip}   ${h.detail}`);
  }
  if (!hits.length) {
    console.log('  Нэг ч төхөөрөмж хариулсангүй — фитнесийн WiFi-д холбогдсон эсэхээ шалгана уу.');
  }
}

void main();
