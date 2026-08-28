/**
 * Терминал дээрх БҮХ өгөгдлийг татаж хадгална.
 *
 *   npm run export-device
 *   npm run export-device -- --events-days 30
 *
 * ⛔ ЗӨВХӨН УНШИНА. Хэрэглэгч үүсгэх, засах, устгах, хаалга нээх —
 * НЭГ Ч бичих дуудлага байхгүй. Ажиллаж байгаа фитнесийн терминал дээр
 * аюулгүй ажиллуулж болно.
 *
 * Юу татдаг вэ:
 *   · төхөөрөмжийн мэдээлэл, боломж, цаг, эвент илгээх хаяг
 *   · БҮХ хэрэглэгч (хуудаслаж)
 *   · хэрэглэгч бүрийн царай бүртгэгдсэн эсэх
 *   · нэвтрэлтийн эвент (анхдагчаар 7 хоног)
 *
 * Үр дүн: `export/device-<огноо>.json` + хүн уншихад зориулсан
 * `export/users-<огноо>.csv`
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { IsapiClient } from '../src/modules/device/isapi/isapi.client';

const HOST = process.env.HIK_HOST ?? '';
const PAGE = 30;

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : def;
}

interface DeviceUser {
  employeeNo: string;
  name?: string;
  userType?: string;
  Valid?: { enable?: boolean; beginTime?: string; endTime?: string };
  doorRight?: string;
  [k: string]: unknown;
}

async function main(): Promise<void> {
  if (!HOST) {
    console.error('✗ HIK_HOST тохируулаагүй');
    process.exit(1);
  }
  const days = arg('events-days', 7);
  const api = new IsapiClient({
    host: HOST,
    port: Number(process.env.HIK_PORT ?? 80),
    user: process.env.HIK_USER ?? 'admin',
    password: process.env.HIK_PASSWORD ?? '',
    https: process.env.HIK_HTTPS === 'true',
    timeoutMs: 20_000,
  });

  console.log(`  Терминал: ${HOST}  (зөвхөн уншина)\n`);

  const out: Record<string, unknown> = { host: HOST, at: new Date().toISOString() };

  // ── 1. Төхөөрөмж ──
  process.stdout.write('  1. Төхөөрөмжийн мэдээлэл… ');
  const info = await api.deviceInfo();
  out.device = info;
  console.log(`${info.model} · ${info.firmware}`);

  process.stdout.write('  2. Боломж, цаг, эвентийн хаяг… ');
  out.capabilities = await api.capabilities().catch((e) => ({ error: String(e) }));
  out.time = await api.getTime().catch((e) => ({ error: String(e) }));
  out.httpHosts = await api.getHttpHosts().catch((e) => ({ error: String(e) }));
  console.log('✓');

  // ── 3. Бүх хэрэглэгч ──
  //
  // ⚠ Хуудаслаж татна. `totalMatches` нь ЭХНИЙ хуудсанд л ирдэг тул
  // түүнийг барьж, дуустал нь давтана.
  const users: DeviceUser[] = [];
  let pos = 0;
  let total = 0;
  process.stdout.write('  3. Хэрэглэгчид… ');
  for (;;) {
    const res = await api.raw<{
      UserInfoSearch?: {
        totalMatches?: number;
        numOfMatches?: number;
        UserInfo?: DeviceUser[];
        responseStatusStrg?: string;
      };
    }>('POST', '/ISAPI/AccessControl/UserInfo/Search?format=json', {
      UserInfoSearchCond: {
        searchID: 'winfit-export',
        searchResultPosition: pos,
        maxResults: PAGE,
      },
    });
    const s = res.UserInfoSearch ?? {};
    total = s.totalMatches ?? total;
    const batch = s.UserInfo ?? [];
    users.push(...batch);
    process.stdout.write(`\r  3. Хэрэглэгчид… ${users.length}/${total}`);
    if (!batch.length || users.length >= total) break;
    pos += batch.length;
  }
  out.users = users;
  out.userCount = users.length;
  console.log('');

  // ── 4. Царай ──
  //
  // Багцалж асууна — нэг нэгээр нь асуувал 339 хүсэлт болно.
  process.stdout.write('  4. Царайн бүртгэл… ');
  const nos = users
    .map((u) => Number(u.employeeNo))
    .filter((n) => Number.isFinite(n));
  const faces: Record<number, boolean> = {};
  for (let i = 0; i < nos.length; i += 20) {
    const part = nos.slice(i, i + 20);
    try {
      Object.assign(faces, await api.faceStatus(part));
    } catch {
      for (const n of part) faces[n] = false;
    }
    process.stdout.write(`\r  4. Царайн бүртгэл… ${Math.min(i + 20, nos.length)}/${nos.length}`);
  }
  out.faces = faces;
  const withFace = Object.values(faces).filter(Boolean).length;
  console.log(`  → ${withFace} царайтай`);

  // ── 5. Эвент ──
  process.stdout.write(`  5. Сүүлийн ${days} хоногийн эвент… `);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const events: unknown[] = [];
  let evPos = 0;
  let evTotal = 0;
  for (;;) {
    const e = await api.fetchEvents(from, to, evPos, PAGE);
    evTotal = e.total;
    events.push(...e.events);
    process.stdout.write(`\r  5. Сүүлийн ${days} хоногийн эвент… ${events.length}/${evTotal}`);
    if (!e.events.length || events.length >= evTotal) break;
    evPos += e.events.length;
  }
  out.events = events;
  out.eventCount = events.length;
  console.log('');

  // ── Хадгалах ──
  const dir = join(process.cwd(), 'export');
  await mkdir(dir, { recursive: true });
  const stamp = out.at as string;
  const safe = stamp.replace(/[:.]/g, '-');

  const jsonPath = join(dir, `device-${safe}.json`);
  await writeFile(jsonPath, JSON.stringify(out, null, 2), 'utf8');

  // Хүн уншихад — Excel-д нээж болно.
  const csv = [
    'employeeNo,name,userType,enable,beginTime,endTime,doorRight,face',
    ...users.map((u) => {
      const v = u.Valid ?? {};
      const cell = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
      return [
        cell(u.employeeNo),
        cell(u.name),
        cell(u.userType),
        cell(v.enable),
        cell(v.beginTime),
        cell(v.endTime),
        cell(u.doorRight),
        cell(faces[Number(u.employeeNo)] ? 'тийм' : 'үгүй'),
      ].join(',');
    }),
  ].join('\n');
  const csvPath = join(dir, `users-${safe}.csv`);
  // BOM — Excel кирилл үсгийг зөв уншина.
  await writeFile(csvPath, '﻿' + csv, 'utf8');

  console.log('\n  ─────────────────────────────────────');
  console.log(`  хэрэглэгч : ${users.length} (${withFace} царайтай)`);
  console.log(`  эвент     : ${events.length}`);
  console.log(`  JSON      : ${jsonPath}`);
  console.log(`  CSV       : ${csvPath}`);
}

main().catch((e: unknown) => {
  console.error('\n✗ Татаж чадсангүй:', e instanceof Error ? e.message : e);
  process.exit(1);
});
