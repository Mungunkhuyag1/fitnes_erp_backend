import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B2 — Нэвтрэлт ба ажилтан.
 *
 *  • `staff_users`    — системд нэвтрэх ажилтан (admin / manager / reception)
 *  • `refresh_tokens` — refresh токены hash (rotation, revoke)
 */
export class Auth1787298052867 implements MigrationInterface {
  name = 'Auth1787298052867';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "staff_users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying(160) NOT NULL,
        "password_hash" text NOT NULL,
        "name" character varying(120) NOT NULL,
        "role" character varying(20) NOT NULL DEFAULT 'reception',
        "must_change_password" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "last_login_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_users" PRIMARY KEY ("id"),
        CONSTRAINT "CK_staff_role" CHECK ("role" IN ('reception','manager','admin'))
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_staff_email" ON "staff_users" ("email")`,
    );

    await q.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "staff_user_id" uuid NOT NULL,
        "token_hash" character varying(64) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "user_agent" character varying(300),
        "ip" inet,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_staff" FOREIGN KEY ("staff_user_id")
          REFERENCES "staff_users"("id") ON DELETE CASCADE
      )`);
    await q.query(
      `CREATE INDEX "ix_refresh_staff" ON "refresh_tokens" ("staff_user_id")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_refresh_hash" ON "refresh_tokens" ("token_hash")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "refresh_tokens"`);
    await q.query(`DROP TABLE "staff_users"`);
  }
}
