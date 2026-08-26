import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B3 — Багц ба гишүүн.
 *
 *  • `packages`       — гишүүнчлэлийн багц (зөвхөн хугацаа)
 *  • `members`        — гишүүн
 *  • `member_no_seq`  — гишүүний дугаарын дараалал (Hikvision `employeeNo`)
 *
 * Дугаар 1001-ээс эхэлнэ: гурван оронтой дугаар нүдэнд танил, мөн 1–1000-ыг
 * ирээдүйд системийн/туршилтын бүртгэлд нөөцөлж үлдээв.
 */
export class Members1787298789047 implements MigrationInterface {
  name = 'Members1787298789047';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "packages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(120) NOT NULL,
        "days" integer NOT NULL,
        "price" bigint NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_packages" PRIMARY KEY ("id"),
        CONSTRAINT "CK_packages_days" CHECK ("days" BETWEEN 1 AND 3650),
        CONSTRAINT "CK_packages_price" CHECK ("price" >= 0)
      )`);
    await q.query(`CREATE INDEX "ix_packages_active" ON "packages" ("active")`);

    // Гишүүний дугаар — устгасан ч ДАХИН олгогдохгүй.
    await q.query(`CREATE SEQUENCE "member_no_seq" START WITH 1001 INCREMENT BY 1`);

    await q.query(`
      CREATE TABLE "members" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "member_no" integer NOT NULL,
        "name" character varying(120) NOT NULL,
        "phone" character varying(8) NOT NULL,
        "email" character varying(160),
        "note" character varying(1000),
        "status" character varying(20) NOT NULL DEFAULT 'lead',
        "access_ends_at" TIMESTAMP WITH TIME ZONE,
        "face_enrolled" boolean NOT NULL DEFAULT false,
        "face_enrolled_at" TIMESTAMP WITH TIME ZONE,
        "hik_synced_at" TIMESTAMP WITH TIME ZONE,
        "hik_sync_error" character varying(500),
        "loopy_card_serial" character varying(64),
        "loopy_customer_id" uuid,
        "pay_token" character varying(64) NOT NULL,
        "last_visit_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_members" PRIMARY KEY ("id"),
        CONSTRAINT "CK_members_status" CHECK ("status" IN
          ('lead','active','expired','suspended','cancelled')),
        CONSTRAINT "CK_members_phone" CHECK ("phone" ~ '^[5-9][0-9]{7}$')
      )`);
    await q.query(`CREATE UNIQUE INDEX "uq_members_no" ON "members" ("member_no")`);
    await q.query(`CREATE UNIQUE INDEX "uq_members_phone" ON "members" ("phone")`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_members_card" ON "members" ("loopy_card_serial")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_members_pay_token" ON "members" ("pay_token")`,
    );
    await q.query(`CREATE INDEX "ix_members_status" ON "members" ("status")`);
    await q.query(
      `CREATE INDEX "ix_members_ends_at" ON "members" ("access_ends_at")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "members"`);
    await q.query(`DROP SEQUENCE "member_no_seq"`);
    await q.query(`DROP TABLE "packages"`);
  }
}
