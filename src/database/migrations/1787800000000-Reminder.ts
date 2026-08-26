import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B11 — Сануулгын бүртгэл.
 *
 * Нэг гишүүнчлэлийн мөчлөгт нэг цэг дээр НЭГ л удаа сануулна. Давхардлыг
 * DB-ийн unique index барина — scheduler хоёр удаа ажилласан ч, эсвэл гараар
 * дуудсан ч хэрэглэгчид давхар мэдэгдэл очихгүй.
 */
export class Reminder1787800000000 implements MigrationInterface {
  name = 'Reminder1787800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "reminder_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "member_id" uuid NOT NULL,
        "membership_id" uuid NOT NULL,
        "milestone" character varying(8) NOT NULL,
        "devices" integer NOT NULL DEFAULT 0,
        "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reminder_log" PRIMARY KEY ("id"),
        CONSTRAINT "FK_reminder_member" FOREIGN KEY ("member_id")
          REFERENCES "members"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reminder_membership" FOREIGN KEY ("membership_id")
          REFERENCES "memberships"("id") ON DELETE CASCADE
      )`);
    await q.query(`
      CREATE UNIQUE INDEX "uq_reminder_once" ON "reminder_log"
        ("membership_id", "milestone")`);
    await q.query(
      `CREATE INDEX "ix_reminder_member" ON "reminder_log" ("member_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "reminder_log"`);
  }
}
