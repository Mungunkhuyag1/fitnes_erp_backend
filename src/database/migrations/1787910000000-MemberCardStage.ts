import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Wallet картын явцыг хянах талбарууд.
 *
 * Гурвуулаа nullable — `NULL` нь «хараахан шалгаагүй» гэсэн утгатай бөгөөд
 * «үгүй»-гээс ялгаатай. Шөнийн тулгалт эдгээрийг бөглөнө.
 */
export class MemberCardStage1787910000000 implements MigrationInterface {
  name = 'MemberCardStage1787910000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "members"
        ADD "loopy_allowed_at" TIMESTAMP WITH TIME ZONE,
        ADD "wallet_devices" integer,
        ADD "wallet_checked_at" TIMESTAMP WITH TIME ZONE
    `);
    // «Засвар шаардлагатай» гишүүдийг хурдан олох — /sync дэлгэц үүгээр шүүнэ.
    await q.query(`
      CREATE INDEX "IDX_member_not_allowed" ON "members" ("id")
        WHERE "loopy_allowed_at" IS NULL AND "status" <> 'cancelled'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "IDX_member_not_allowed"`);
    await q.query(`
      ALTER TABLE "members"
        DROP COLUMN "wallet_checked_at",
        DROP COLUMN "wallet_devices",
        DROP COLUMN "loopy_allowed_at"
    `);
  }
}
