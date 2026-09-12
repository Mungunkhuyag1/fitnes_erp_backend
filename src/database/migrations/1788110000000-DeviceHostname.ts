import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `devices.ip` — домэйн нэр багтаах өргөн.
 *
 * ⚠ Урьд нь `varchar(45)` байв. Тэр нь IPv6-д хангалттай ч ДОМЭЙН
 * НЭРД богино: туннелийн хаяг (`exempt-jewish-submitting-campaigns
 * .trycloudflare.com`) нь 52 тэмдэгт.
 *
 * Терминал NAT-ын ард байдаг тул үүлэн backend нь дотоод IP руу
 * хүрэх боломжгүй — туннель эсвэл agent-ийн ДОМЭЙН хаягаар л
 * холбогдоно. Өөрөөр хэлбэл газар дээр ажиллах цорын ганц хувилбар
 * нь баганад багтахгүй байв.
 *
 * DNS-ийн дээд урт нь 253 тул 255 хангалттай.
 */
export class DeviceHostname1788110000000 implements MigrationInterface {
  name = 'DeviceHostname1788110000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "devices" ALTER COLUMN "ip" TYPE character varying(255)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // ⚠ 45 тэмдэгтээс урт утга байвал буцаах нь АЛДАА өгнө. Тиймээс
    // эхлээд хэтэрсэн мөрийг цэвэрлэнэ — тэдгээр нь домэйн хаяг тул
    // IP руу буцаах утгагүй.
    await q.query(`UPDATE "devices" SET "ip" = NULL WHERE length("ip") > 45`);
    await q.query(
      `ALTER TABLE "devices" ALTER COLUMN "ip" TYPE character varying(45)`,
    );
  }
}
