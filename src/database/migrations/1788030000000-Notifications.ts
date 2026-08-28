import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Мэдэгдэл хүлээн авагчид.
 *
 * Заалны эзэн, менежер нар өдрийн орлогыг мэйлээр авна. Хаягийг `.env`-д
 * биш DB-д хадгалдаг нь санаатай: хүн нэмэх/хасахад deploy шаардахгүй.
 */
export class Notifications1788030000000 implements MigrationInterface {
  name = 'Notifications1788030000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "notification_recipients" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying(160) NOT NULL,
        "name" character varying(120),
        "events" text array NOT NULL DEFAULT '{}',
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notification_recipients" PRIMARY KEY ("id")
      )`);
    // Нэг хаягийг хоёр удаа бүртгэвэл давхар мэйл очно.
    await q.query(
      `CREATE UNIQUE INDEX "uq_notif_email" ON "notification_recipients" (lower("email"))`,
    );

    await q.query(`
      CREATE TABLE "email_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "to_email" character varying(160) NOT NULL,
        "subject" character varying(300) NOT NULL,
        "template" character varying(40) NOT NULL,
        "status" character varying(12) NOT NULL,
        "provider_id" character varying(120),
        "error" character varying(500),
        "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_email_log" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE INDEX "ix_email_log_sent" ON "email_log" ("sent_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "email_log"`);
    await q.query(`DROP TABLE "notification_recipients"`);
  }
}
