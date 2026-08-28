import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Терминалын холболтын тохиргоог DB-д — дэлгэцээс тохируулах боломж.
 *
 * IP нь DHCP-ээр солигддог, нууц үг нь заалан дээр солигдож болно.
 * Аль аль нь `.env` дээр байвал ажилтан өөрөө засаж чадахгүй, дахин
 * deploy шаардана. Нууц үгийг НУУЦЛААД хадгална (`secret-box.ts`).
 */
export class DeviceCredentials1788000000000 implements MigrationInterface {
  name = 'DeviceCredentials1788000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "devices" ADD "port" integer`);
    await q.query(`ALTER TABLE "devices" ADD "username" character varying(60)`);
    await q.query(`ALTER TABLE "devices" ADD "password_enc" text`);
    await q.query(`ALTER TABLE "devices" ADD "https" boolean`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "devices" DROP COLUMN "https"`);
    await q.query(`ALTER TABLE "devices" DROP COLUMN "password_enc"`);
    await q.query(`ALTER TABLE "devices" DROP COLUMN "username"`);
    await q.query(`ALTER TABLE "devices" DROP COLUMN "port"`);
  }
}
