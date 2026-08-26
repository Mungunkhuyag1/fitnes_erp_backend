import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B4 — Outbox дараалал.
 *
 * Гадаад нөлөө (терминал, Loopy, мэдэгдэл) бүр эндүүр дамжина. Бизнесийн
 * транзакц дотор зөвхөн мөр бичигдэж, worker дараа нь илгээнэ.
 */
export class Outbox1787299900000 implements MigrationInterface {
  name = 'Outbox1787299900000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "outbox" (
        "id" bigserial NOT NULL,
        "topic" character varying(60) NOT NULL,
        "payload" jsonb NOT NULL,
        "group_key" character varying(80),
        "status" character varying(12) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_error" character varying(1000),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "processed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_outbox" PRIMARY KEY ("id"),
        CONSTRAINT "CK_outbox_status" CHECK ("status" IN ('pending','done','failed'))
      )`);

    await q.query(`CREATE INDEX "ix_outbox_status" ON "outbox" ("status")`);
    await q.query(`CREATE INDEX "ix_outbox_group" ON "outbox" ("group_key")`);

    // Worker-ийн claim асуулгын гол индекс: бүлэг тус бүрийн хамгийн эрт
    // хүлээгдэж буй мөрийг олно. Хэсэгчилсэн (partial) — `done` мөрүүд
    // хуримтлагдсан ч индекс жижиг хэвээр байна.
    await q.query(`
      CREATE INDEX "ix_outbox_ready" ON "outbox"
        (COALESCE("group_key", "id"::text), "created_at", "id")
        WHERE "status" = 'pending'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "outbox"`);
  }
}
