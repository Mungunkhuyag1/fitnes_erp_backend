import 'dotenv/config';
import { writeFileSync } from 'fs';
import { IsapiClient, DigestAuthError } from '../src/modules/device/isapi/isapi.client';

/**
 * ТЕРМИНАЛЫГ ШАЛГАХ СКРИПТ — фитнест очиж НЭГ удаа ажиллуулна.
 *
 *   HIK_HOST=192.168.1.64 HIK_USER=admin HIK_PASSWORD=... npm run probe
 *
 * Юу хийдэг вэ: ISAPI-ийн гол 9 дуудлагыг дараалан хийж, хариуг БҮТНЭЭР
 * файлд бичнэ. Тэр файлаас `docs/03-isapi-findings.md` гарч, mock server
 * үүсгэх боломжтой болно — цаашид фитнест очихгүйгээр хөгжүүлнэ.
 *
 * ⚠ АЮУЛГҮЙ БАЙДАЛ: нууц үг буруу бол ШУУД зогсоно. Hikvision нь 5 удаа
 * буруу оролдлогод IP-г 30 минут блокдог тул дахин оролдохгүй.
 *
 * ⚠ Энэ скрипт төхөөрөмж дээр ЮУ Ч ӨӨРЧЛӨХГҮЙ — зөвхөн уншина.
 * (Туршилтын хэрэглэгч үүсгэхийг `--write` тугаар тусад нь асууна.)
 */

interface Step {
  name: string;
  run: () => Promise<unknown>;
  /** Амжилтгүй болвол цааш үргэлжлүүлэх эсэх. */
  critical?: boolean;
}

const results: Record<string, unknown> = {};
const errors: Record<string, string> = {};

async function main(): Promise<void> {
  const host = process.env.HIK_HOST;
  const user = process.env.HIK_USER ?? 'admin';
  const password = process.env.HIK_PASSWORD;

  if (!host || !password) {
    console.error('⛔ HIK_HOST ба HIK_PASSWORD шаардлагатай.');
    console.error('   Жишээ: HIK_HOST=192.168.1.64 HIK_USER=admin HIK_PASSWORD=xxx npm run probe');
    process.exit(1);
  }

  const api = new IsapiClient({
    host,
    port: Number(process.env.HIK_PORT ?? 80),
    user,
    password,
    https: process.env.HIK_HTTPS === 'true',
    timeoutMs: 20_000,
  });

  console.log(`\n  Терминал: ${api.address}  (хэрэглэгч: ${user})\n`);

  const writeMode = process.argv.includes('--write');
  const testEmployeeNo = 999999; // туршилтын дугаар — жинхэнэ гишүүнтэй мөргөлдөхгүй

  const steps: Step[] = [
    {
      name: '1. deviceInfo — амьд эсэх, firmware',
      critical: true,
      run: async () => {
        const d = await api.deviceInfo();
        console.log(`     модель  : ${d.model}`);
        console.log(`     firmware: ${d.firmware}`);
        return d;
      },
    },
    {
      name: '2. capabilities — энэ firmware юу дэмждэг',
      run: () => api.capabilities(),
    },
    {
      name: '3. system/time — цаг зөрсөн эсэх',
      run: async () => {
        const t = await api.getTime();
        const device = new Date(t.localTime).getTime();
        const skewSec = Math.round(Math.abs(Date.now() - device) / 1000);
        console.log(`     терминал: ${t.localTime}  (${t.timeZone})`);
        console.log(
          `     зөрүү   : ${skewSec} сек ${skewSec > 60 ? '⚠ NTP тохируулах шаардлагатай' : '✓'}`,
        );
        return { ...t, skewSec };
      },
    },
    {
      name: '4. UserInfo/Search — одоо хэдэн хэрэглэгч байна',
      run: async () => {
        // employeeNo 1 байгаа эсэхийг шалгах — хариуны БҮТЦИЙГ харах гол зорилго
        const u = await api.searchUser(1);
        console.log(`     employeeNo=1 → ${u ? 'олдлоо' : 'алга'}`);
        return u;
      },
    },
    {
      name: '5. FDLib/FDSearch — царайн сангийн хариу',
      run: async () => {
        const f = await api.faceStatus([1]);
        console.log(`     employeeNo=1 царай → ${f[1] ? 'бүртгэлтэй' : 'алга'}`);
        return f;
      },
    },
    {
      name: '6. AcsEvent — сүүлийн 24 цагийн нэвтрэлт',
      run: async () => {
        const to = new Date();
        const from = new Date(to.getTime() - 86_400_000);
        const e = await api.fetchEvents(from, to, 0, 20);
        console.log(`     нийт ${e.total} эвент, эхний ${e.events.length}-г татав`);
        if (e.events[0]) {
          console.log('     эхний эвентийн ТАЛБАРУУД:');
          for (const [k, v] of Object.entries(e.events[0])) {
            console.log(`       ${k} = ${JSON.stringify(v)?.slice(0, 60)}`);
          }
        }
        return e;
      },
    },
    {
      name: '7. httpHosts — эвент илгээх хаяг тохируулагдсан эсэх',
      run: () => api.getHttpHosts(),
    },
  ];

  if (writeMode) {
    steps.push(
      {
        name: `8. [WRITE] Туршилтын хэрэглэгч үүсгэх (№${testEmployeeNo})`,
        run: () =>
          api.upsertUser({
            employeeNo: testEmployeeNo,
            name: 'WinFit Probe',
            beginTime: '2026-01-01T00:00:00',
            endTime: '2026-01-01T00:00:01',
            enable: true,
          }),
      },
      {
        name: `9. [WRITE] Туршилтын хэрэглэгчийг УСТГАХ`,
        run: () => api.deleteUser(testEmployeeNo),
      },
    );
  }

  for (const step of steps) {
    process.stdout.write(`  ${step.name}\n`);
    try {
      results[step.name] = await step.run();
      console.log('     ✓\n');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors[step.name] = msg;
      console.log(`     ✗ ${msg}\n`);

      if (e instanceof DigestAuthError) {
        console.error('  ⛔ ЗОГСЛОО — нэвтрэлт амжилтгүй. ДАХИН БҮҮ ОРОЛД.');
        console.error('     Hikvision нь 5 удаа буруу оролдлогод IP-г 30 мин блокдог.');
        break;
      }
      if (step.critical) {
        console.error('  ⛔ ЗОГСЛОО — үндсэн холболт ажиллахгүй байна.');
        break;
      }
    }
  }

  const out = `probe-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
  writeFileSync(
    out,
    JSON.stringify(
      { device: api.address, at: new Date().toISOString(), results, errors },
      null,
      2,
    ),
  );

  const okCount = Object.keys(results).length;
  const failCount = Object.keys(errors).length;
  console.log(`  ─────────────────────────────────────`);
  console.log(`  ${okCount} амжилттай, ${failCount} алдаа`);
  console.log(`  Бүтэн хариу: ${out}`);
  console.log(`  → Энэ файлыг надад өгвөл docs/03-isapi-findings.md + mock үүсгэнэ.\n`);
}

main().catch((e: unknown) => {
  console.error('✗', e instanceof Error ? e.message : e);
  process.exit(1);
});
