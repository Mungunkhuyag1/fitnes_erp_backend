import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Сануулгын бүртгэлд ШҮҮГЭЭНИЙ төрөл нэмэв.
 *
 * Урьд нь зөвхөн гишүүнчлэлийн хугацааг сануулдаг байсан. Шүүгээний
 * түрээс дуусахыг гишүүн урьдчилж мэдэх ямар ч суваггүй байв.
 *
 * ⚠ Хоёр төрөл ТУСДАА unique индекстэй: нэг баганад хоёуланг нь шахвал
 * `membership_id` баганад шүүгээний ID хадгалагдаж, багана нэрээ хуурна.
 */
export class ReminderLocker1787970000000 implements MigrationInterface {
  name = 'ReminderLocker1787970000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "reminder_log"
        ADD COLUMN "kind" varchar(12) NOT NULL DEFAULT 'membership',
        ADD COLUMN "locker_assignment_id" uuid,
        ALTER COLUMN "membership_id" DROP NOT NULL
    `);
    // Хуучин индексийг ХЭСЭГЧИЛСЭН болгож солино.
    await q.query(`DROP INDEX "uq_reminder_once"`);
    await q.query(`
      CREATE UNIQUE INDEX "uq_reminder_once"
        ON "reminder_log" ("membership_id", "milestone")
        WHERE "kind" = 'membership'
    `);
    await q.query(`
      CREATE UNIQUE INDEX "uq_reminder_locker"
        ON "reminder_log" ("locker_assignment_id", "milestone")
        WHERE "kind" = 'locker'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "uq_reminder_locker"`);
    await q.query(`DROP INDEX "uq_reminder_once"`);
    await q.query(`DELETE FROM "reminder_log" WHERE "kind" <> 'membership'`);
    await q.query(`
      ALTER TABLE "reminder_log"
        DROP COLUMN "kind",
        DROP COLUMN "locker_assignment_id",
        ALTER COLUMN "membership_id" SET NOT NULL
    `);
    await q.query(`
      CREATE UNIQUE INDEX "uq_reminder_once"
        ON "reminder_log" ("membership_id", "milestone")
    `);
  }
}
