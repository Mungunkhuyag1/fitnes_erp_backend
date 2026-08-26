import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * L1 — Шүүгээ (locker): түлхүүр олгох ба түрээс.
 *
 * ⚠ Эрэгтэй/эмэгтэй хувцас солих өрөөний шүүгээний ДУГААРЛАЛТ ТУСДАА —
 * хоёуланд нь «42» дугаартай шүүгээ байна. Тиймээс өвөрмөц түлхүүр нь
 * `(zone, number)` хос.
 */
export class Locker1787600000000 implements MigrationInterface {
  name = 'Locker1787600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "lockers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "zone" character varying(60) NOT NULL,
        "number" integer NOT NULL,
        "note" character varying(300),
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lockers" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lockers_number" CHECK ("number" BETWEEN 1 AND 99999)
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_lockers_zone_number" ON "lockers" ("zone", "number")`,
    );

    await q.query(`
      CREATE TABLE "locker_assignments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "locker_id" uuid NOT NULL,
        "locker_zone" character varying(60) NOT NULL,
        "locker_number" integer NOT NULL,
        "member_id" uuid NOT NULL,
        "type" character varying(10) NOT NULL,
        "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "issued_by" uuid,
        "due_at" TIMESTAMP WITH TIME ZONE,
        "returned_at" TIMESTAMP WITH TIME ZONE,
        "returned_by" uuid,
        "amount" bigint NOT NULL DEFAULT 0,
        "source" character varying(12),
        "note" character varying(300),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_locker_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_locker_asg_locker" FOREIGN KEY ("locker_id")
          REFERENCES "lockers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_locker_asg_member" FOREIGN KEY ("member_id")
          REFERENCES "members"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_locker_asg_type" CHECK ("type" IN ('daily','rental')),
        -- Түрээс заавал дуусах хугацаатай, өдрийн түлхүүр хугацаагүй.
        CONSTRAINT "CK_locker_asg_due" CHECK (
          ("type" = 'rental' AND "due_at" IS NOT NULL) OR
          ("type" = 'daily'  AND "due_at" IS NULL))
      )`);

    /**
     * ★ Нэг шүүгээнд нэг зэрэг ЗӨВХӨН НЭГ идэвхтэй олголт.
     *
     * «Хоёр хүнд нэг түлхүүр өглөө» гэсэн алдаа DB түвшинд боломжгүй —
     * кодын алдаа, зэрэг ирсэн хоёр хүсэлт ч үүнийг давж чадахгүй.
     */
    await q.query(`
      CREATE UNIQUE INDEX "uq_locker_active" ON "locker_assignments" ("locker_id")
        WHERE "returned_at" IS NULL`);

    /** Нэг гишүүнд нэг зэрэг нэг л ижил төрлийн түлхүүр. */
    await q.query(`
      CREATE UNIQUE INDEX "uq_locker_member_active"
        ON "locker_assignments" ("member_id", "type")
        WHERE "returned_at" IS NULL`);

    await q.query(
      `CREATE INDEX "ix_locker_asg_member" ON "locker_assignments" ("member_id", "issued_at" DESC)`,
    );
    await q.query(
      `CREATE INDEX "ix_locker_asg_locker" ON "locker_assignments" ("locker_id")`,
    );
    // Хугацаа хэтэрсэн түрээсийг хурдан олох (dashboard, сануулга).
    await q.query(`
      CREATE INDEX "ix_locker_asg_due" ON "locker_assignments" ("due_at")
        WHERE "returned_at" IS NULL AND "due_at" IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "locker_assignments"`);
    await q.query(`DROP TABLE "lockers"`);
  }
}
