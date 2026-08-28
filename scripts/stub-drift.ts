/**
 * Stub терминал дээр ТУРШИЛТЫН зөрүү үүсгэх / арилгах.
 *
 * Stub-ын өгөгдөл нь backend процессын САНАХ ОЙД байдаг тул шууд файл
 * засаж болохгүй — ажиллаж буй сервер рүү хүсэлт илгээнэ.
 *
 *   npm run stub:drift          # 3-3-3 зөрүү үүсгэнэ
 *   npm run stub:drift -- 5     # ангилал тус бүрд 5
 *   npm run stub:reset          # анхны байдалд буцаана
 */
const BASE = process.env.STUB_API ?? 'http://localhost:3100/api';
const EMAIL = process.env.STUB_EMAIL ?? 'admin@winfit.mn';
const PASSWORD = process.env.STUB_PASSWORD;

async function main(): Promise<void> {
  if (!PASSWORD) {
    console.error('STUB_PASSWORD тохируулна уу (админы нууц үг)');
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
