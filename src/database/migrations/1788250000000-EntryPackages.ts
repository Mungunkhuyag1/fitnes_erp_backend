import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Оролтоор тоолдог багц («2 сард 12 оролт»).
 *
 *  • `packages.entries`              — багцын оролтын тоо (null = хоногийн)
 *  • `memberships.entries`           — олгосон оролт (худалдан авалтын хуулбар)
 *  • `memberships.entries_used`      — хасагдсан оролт (бүлгийн тэргүүн мөр)
 *  • `memberships.joins_previous`    — өмнөх оролтын бүлгийн үргэлжлэл
 *  • `memberships.closed_at`         — оролт дуусч эрх хаагдсан агшин
 *  • `access_events.entry_membership_id` — энэ уншуулалтад оролт хасагдсан уу
 *
 * Бүгд НЭМЭЛТ, nullable/анхдагчтай — одоогийн хоногийн багцууд, гишүүнчлэл
 * огт өөрчлөгдөхгүй.
 */
export class EntryPackages1788250000000 implements MigrationInterface {
  name = 'EntryPackages1788250000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "entries" integer`,
    );
    await q.query(
      `ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "entries" integer`,
    );
    await q.query(
      `ALTER TABLE "memberships"
         ADD COLUMN IF NOT EXISTS "entries_used" integer NOT NULL DEFAULT 0`,
    );
    await q.query(
      `ALTER TABLE "memberships"
         ADD COLUMN IF NOT EXISTS "joins_previous" boolean NOT NULL DEFAULT false`,
    );
    await q.query(
      `ALTER TABLE "memberships"
         ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(
      `ALTER TABLE "access_events"
         ADD COLUMN IF NOT EXISTS "entry_membership_id" uuid`,
    );
    /*
     * ★ «0 хоног + N оролт» мөр зөвшөөрнө (оролтын бүлэгт гараар нэмсэн
     * оролт). Хуучин `days BETWEEN 1 AND 3650` үүнийг хориглож байсан.
     * Хоног ч, оролт ч байхгүй хоосон мөр хориотой хэвээр.
     */
    await q.query(
      `ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "CK_memberships_days"`,
    );
    await q.query(
      `ALTER TABLE "memberships" ADD CONSTRAINT "CK_memberships_days"
         CHECK ("days" BETWEEN 0 AND 3650 AND ("days" >= 1 OR "entries" >= 1))`,
    );
    await q.query(
      `ALTER TABLE "memberships" ADD CONSTRAINT "CK_memberships_entries"
         CHECK ("entries" IS NULL OR "entries" >= 0)`,
    );
    /* Хасалт шалгахад: «энэ гишүүнд энэ цонхонд хасагдсан уншуулалт
     * байна уу». Хэсэгчилсэн — хасагдсан мөр л индекст орно. */
    await q.query(
      `CREATE INDEX IF NOT EXISTS "ix_access_entry_charged"
         ON "access_events" ("member_id", "event_at")
         WHERE "entry_membership_id" IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "ix_access_entry_charged"`);
    // ⚠ 0 хоногтой мөр байвал хуучин хязгаарлалт тогтохгүй — эхлээд
    // тэдгээрийг гараар буцаах/устгах шаардлагатай.
    await q.query(
      `ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "CK_memberships_entries"`,
    );
    await q.query(
      `ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "CK_memberships_days"`,
    );
    await q.query(
      `ALTER TABLE "memberships" ADD CONSTRAINT "CK_memberships_days"
         CHECK ("days" BETWEEN 1 AND 3650)`,
    );
    await q.query(
      `ALTER TABLE "access_events" DROP COLUMN IF EXISTS "entry_membership_id"`,
    );
    await q.query(`ALTER TABLE "memberships" DROP COLUMN IF EXISTS "closed_at"`);
    await q.query(
      `ALTER TABLE "memberships" DROP COLUMN IF EXISTS "joins_previous"`,
    );
    await q.query(
      `ALTER TABLE "memberships" DROP COLUMN IF EXISTS "entries_used"`,
    );
    await q.query(`ALTER TABLE "memberships" DROP COLUMN IF EXISTS "entries"`);
    await q.query(`ALTER TABLE "packages" DROP COLUMN IF EXISTS "entries"`);
  }
}
