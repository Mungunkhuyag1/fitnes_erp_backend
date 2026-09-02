import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `memberships.source`-д `freeze` утгыг нэмнэ.
 *
 * Чөлөөний хоногийг дэвтэрт бичихээс өөр арга байхгүй: `recompute()` нь
 * `access_ends_at`-ыг `memberships`-аас дахин тооцдог тул шууд огноо
 * нэмбэл дараагийн тооцоололд арилна.
 */
export class FreezeSource1788050000000 implements MigrationInterface {
  name = 'FreezeSource1788050000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "memberships" DROP CONSTRAINT "CK_memberships_source"`);
    await q.query(
      `ALTER TABLE "memberships" ADD CONSTRAINT "CK_memberships_source" ` +
        `CHECK (source IN ('bonum','cash','manual','freeze'))`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM "memberships" WHERE source = 'freeze'`);
    await q.query(`ALTER TABLE "memberships" DROP CONSTRAINT "CK_memberships_source"`);
    await q.query(
      `ALTER TABLE "memberships" ADD CONSTRAINT "CK_memberships_source" ` +
        `CHECK (source IN ('bonum','cash','manual'))`,
    );
  }
}
