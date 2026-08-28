/**
 * Stub терминал дээр ТУРШИЛТЫН зөрүү үүсгэх / арилгах.
 *
 * Stub-ын өгөгдөл нь backend процессын САНАХ ОЙД байдаг тул шууд файл
 * засаж болохгүй — ажиллаж буй сервер рүү хүсэлт илгээнэ.
 *
 *   npm run stub:drift          # 3-3-3 зөрүү үүсгэнэ
 *   npm run stub:drift -- 5     # ангилал тус бүрд 5
 *   npm run stub:reset          # анхны байдалд буцаана
 *
 * Админы нууц үгийг асууна (терминал дээр харагдахгүй). Давтаж
 * ажиллуулах бол `export STUB_PASSWORD=…` гэж тавьж болно.
 */
import { createInterface } from 'readline';

const BASE = process.env.STUB_API ?? 'http://localhost:3100/api';
const EMAIL = process.env.STUB_EMAIL ?? 'admin@winfit.mn';

/**
 * Нууц үгийг АСУУНА — терминал дээр харагдахгүй.
 *
 * ЯАГААД env-ээр шаарддаггүй вэ: `STUB_PASSWORD='...' npm run …` гэж
 * бичвэл нууц үг shell-ийн түүхэнд (`~/.zsh_history`) үлдэнэ. Файлд
 * хадгалах нь ч мөн адил — асуух нь хамгийн цэвэр.
 */
function askPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Бичсэн тэмдэгтийг цуурайлахгүй болгоно.
  const out = rl as unknown as { _writeToOutput: (s: string) => void };
  const orig = out._writeToOutput.bind(rl);
  let hide = false;
  out._writeToOutput = (str: string) => {
    if (!hide) orig(str);
  };

  return new Promise((resolve) => {
    rl.question(`${EMAIL} нууц үг: `, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    hide = true;
  });
}

async function main(): Promise<void> {
  const PASSWORD = process.env.STUB_PASSWORD || (await askPassword());
  if (!PASSWORD) {
    console.error('Нууц үг хоосон байна');
    process.exit(1);
  }

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`Нэвтэрч чадсангүй (${login.status}) — сервер асаалттай юу?`);
    process.exit(1);
  }
  const { accessToken } = (await login.json()) as { accessToken: string };
  const auth = { authorization: `Bearer ${accessToken}` };

  const reset = process.argv.includes('--reset');
  const n = Number(process.argv.find((a) => /^\d+$/.test(a))) || 3;
  const path = reset ? 'devices/stub/reset' : `devices/stub/drift?n=${n}`;

  const res = await fetch(`${BASE}/${path}`, { method: 'POST', headers: auth });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error(`Алдаа (${res.status}):`, body.message ?? body);
    process.exit(1);
  }

  if (reset) {
    console.log(`✓ Анхны байдалд буцаав — ${body.users} хэрэглэгч`);
  } else {
    const r = body as {
      removed: number[];
      shifted: number[];
      added: { employeeNo: number; name: string }[];
    };
    console.log('✓ Туршилтын зөрүү үүсгэв:');
    console.log(`  Терминал дээр алга  → №${r.removed.join(', №')}`);
    console.log(`  Огноо зөрсөн (+45х) → №${r.shifted.join(', №')}`);
    console.log(`  WinFit-д алга       → ${r.added.map((a) => `№${a.employeeNo} ${a.name}`).join(', ')}`);
  }

  // Тулгалт юуг олсныг ШУУД харуулна — тусад нь шалгах шаардлагагүй.
  const diff = (await (
    await fetch(`${BASE}/sync/run/device-audit/diff`, { headers: auth })
  ).json()) as Record<string, unknown[]>;
  console.log(
    `\nТулгалт: алга ${diff.missing.length} · огноо ${diff.drift.length} · ` +
      `илүү ${diff.extras.length} · нэр ${diff.nameDiff.length}`,
  );
  console.log('Дэлгэц: Синк → Терминалын бүрэн тулгалт → «Зөрүү харах»');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
