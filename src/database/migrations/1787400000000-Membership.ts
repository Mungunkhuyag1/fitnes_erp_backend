import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B5 — Гишүүнчлэл, аудит, тохиргоо.
 *
 *  • `memberships` — худалдан авалтын дэвтэр (эрхийн ЭХ СУРВАЛЖ)
 *  • `audit_log`   — гар ажиллагааны өөрчлөлт бүр
 *  • `settings`    — dashboard-аас өөрчилдөг ажиллагааны тохиргоо
 */
export class Membership1787400000000 implements MigrationInterface {
  name = 'Membership1787400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "memberships" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "member_id" uuid NOT NULL,
        "package_id" uuid,
        "package_name" character varying(120),
        "days" integer NOT NULL,
        "amount" bigint NOT NULL,
        "source" character varying(12) NOT NULL,
        "invoice_id" uuid,
        "staff_user_id" uuid,
        "reason" character varying(500),
        "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "reversed_at" TIMESTAMP WITH TIME ZONE,
        "reversed_by" uuid,
        "reverse_reason" character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_memberships" PRIMARY KEY ("id"),
        CONSTRAINT "FK_memberships_member" FOREIGN KEY ("member_id")
          REFERENCES "members"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_memberships_source" CHECK ("source" IN ('bonum','cash','manual')),
        CONSTRAINT "CK_memberships_days" CHECK ("days" BETWEEN 1 AND 3650),
        CONSTRAINT "CK_memberships_amount" CHECK ("amount" >= 0)
      )`);
    await q.query(
      `CREATE INDEX "ix_memberships_member" ON "memberships" ("member_id", "created_at")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_memberships_idem" ON "memberships" ("idempotency_key")`,
    );
    await q.query(
      `CREATE INDEX "ix_memberships_created" ON "memberships" ("created_at")`,
    );

    await q.query(`
      CREATE TABLE "audit_log" (
        "id" bigserial NOT NULL,
        "staff_user_id" uuid,
        "action" character varying(60) NOT NULL,
        "entity" character varying(40) NOT NULL,
        "entity_id" character varying(64),
        "before" jsonb,
        "after" jsonb,
        "reason" character varying(500),
        "ip" inet,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE INDEX "ix_audit_staff" ON "audit_log" ("staff_user_id")`);
    await q.query(`CREATE INDEX "ix_audit_action" ON "audit_log" ("action")`);
    await q.query(`CREATE INDEX "ix_audit_entity" ON "audit_log" ("entity_id")`);
    await q.query(`CREATE INDEX "ix_audit_created" ON "audit_log" ("created_at")`);

    await q.query(`
      CREATE TABLE "settings" (
        "key" character varying(80) NOT NULL,
        "value" jsonb NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_settings" PRIMARY KEY ("key")
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "settings"`);
    await q.query(`DROP TABLE "audit_log"`);
    await q.query(`DROP TABLE "memberships"`);
  }
}
