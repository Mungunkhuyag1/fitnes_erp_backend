import { DataSource } from 'typeorm';
import * as fs from 'fs';

/**
 * Терминалын хаягийг ПРОД санд шууд бичих.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * `connection()` нь `row.ip || HIK_HOST` гэж уншдаг — санд утга
 * байвал орчны хувьсагчийг ҮЛ ТООМСОРЛОНО. Санд демо утга
 * (`192.168.1.64`) сууж байсан тул Railway дээр `HIK_HOST` тавихад
 * нөлөөгүй байв.
 *
 * Хэрэглээ:
 *   ts-node scripts/prod-set-host.ts <хаяг|clear> [порт] [https]
 *
 *   clear  → `ip` нь NULL болно, `HIK_HOST` орчны хувьсагч идэвхжинэ
 *            (баганын 45 тэмдэгтийн хязгаараас урт хаягт ЭНИЙГ)
 */
(async () => {
  const [host, portArg, httpsArg] = process.argv.slice(2);
  if (!host) {
    console.error('Хэрэглээ: prod-set-host.ts <хаяг|clear> [порт] [https]');
    process.exit(1);
  }

  const url = fs
    .readFileSync('.env.railway', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL='))!
    .slice(13)
    .trim();
  const ds = new DataSource({
    type: 'postgres',
    url,
    ssl: { rejectUnauthorized: false },
    synchronize: false,
  });
  await ds.initialize();

  const [before] = await ds.query(
    `SELECT ip, port, https FROM devices ORDER BY created_at LIMIT 1`,
  );
  console.log('өмнө:', before);

  const max = Number(
    (
      await ds.query(
        `SELECT character_maximum_length AS n FROM information_schema.columns
         WHERE table_name='devices' AND column_name='ip'`,
      )
    )[0].n,
  );

  if (host !== 'clear' && host.length > max) {
    console.error(
      `✗ Хаяг ${host.length} тэмдэгт, багана ${max} тэмдэгт хүлээнэ.\n` +
        '  Migration ажиллаагүй байна. `clear` хийгээд HIK_HOST ашиглана уу.',
    );
    await ds.destroy();
    process.exit(1);
  }

  await ds.query(
    `UPDATE devices SET ip = $1, port = $2, https = $3
     WHERE id = (SELECT id FROM devices ORDER BY created_at LIMIT 1)`,
    [
      host === 'clear' ? null : host,
      portArg ? Number(portArg) : null,
      httpsArg === undefined ? null : httpsArg === 'true',
    ],
  );

  const [after] = await ds.query(
    `SELECT ip, port, https FROM devices ORDER BY created_at LIMIT 1`,
  );
  console.log('дараа:', after);
  console.log(
    after.ip === null
      ? '\n✓ `ip` цэвэрлэгдлээ — одоо HIK_HOST орчны хувьсагч ажиллана.'
      : '\n✓ хаяг бичигдлээ.',
  );
  await ds.destroy();
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
