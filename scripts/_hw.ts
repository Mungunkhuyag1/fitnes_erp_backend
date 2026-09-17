import { DataSource } from 'typeorm';
import * as fs from 'fs';
(async () => {
  const url = fs.readFileSync('.env.railway','utf8').split('\n')
    .find(l=>l.startsWith('DATABASE_URL='))!.slice(13).trim();
  const ds = new DataSource({type:'postgres',url,ssl:{rejectUnauthorized:false},synchronize:false});
  await ds.initialize();
  const [d] = await ds.query(
    `SELECT online, last_seen_at, last_error, last_error_at FROM devices WHERE active ORDER BY created_at LIMIT 1`);
  console.log('── devices ──');
  console.log(`  online        ${d.online}`);
  console.log(`  last_seen_at  ${d.last_seen_at ?? '—'}`);
  console.log(`  last_error    ${d.last_error ?? '—'}`);
  console.log(`  last_error_at ${d.last_error_at ?? '—'}`);
  const [m] = await ds.query(
    `SELECT count(*)::int n FROM email_log WHERE created_at > now() - interval '40 minutes'`);
  console.log(`\n  сүүлийн 40 минутад илгээсэн мэйл: ${m.n}`);
  console.log(d.last_error
    ? '\n  ✓ DEVICE_GATEWAY=direct — шалгагч ажиллаж байна'
    : '\n  → last_error хоосон: DEVICE_GATEWAY нь stub эсвэл тавиагүй байна');
  await ds.destroy();
})().catch(e=>{console.error('✗',e.message);process.exit(1);});
