import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B6 — Терминал ба ирцийн бүртгэл.
 */
export class Access1787500000000 implements MigrationInterface {
  name = 'Access1787500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "devices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(120) NOT NULL,
        "serial" character varying(80) NOT NULL,
        "model" character varying(60),
        "ip" character varying(45),
        "door_no" integer NOT NULL DEFAULT 1,
        "firmware" character varying(40),
        "online" boolean NOT NULL DEFAULT false,
        "last_seen_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_devices" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE UNIQUE INDEX "uq_devices_serial" ON "devices" ("serial")`);

    await q.query(`
      CREATE TABLE "access_events" (
        "id" bigserial NOT NULL,
        "device_id" uuid,
        "member_id" uuid,
        "employee_no" integer,
        "event_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "granted" boolean NOT NULL,
        "reason" character varying(20) NOT NULL DEFAULT 'ok',
        "verify_mode" character varying(20),
        "raw" jsonb,
        "dedupe_key" character varying(80) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_access_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_access_device" FOREIGN KEY ("device_id")
          REFERENCES "devices"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_access_member" FOREIGN KEY ("member_id")
          REFERENCES "members"("id") ON DELETE SET NULL
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_access_dedupe" ON "access_events" ("dedupe_key")`,
    );
    await q.query(
      `CREATE INDEX "ix_access_member" ON "access_events" ("member_id", "event_at" DESC)`,
    );
    await q.query(
      `CREATE INDEX "ix_access_at" ON "access_events" ("event_at" DESC)`,
    );

    // «Өдөрт 1 ирц» тайлангийн гол асуулга — зөвхөн зөвшөөрсөн эвент.
    await q.query(`
      CREATE INDEX "ix_access_granted_at" ON "access_events" ("event_at" DESC)
        WHERE "granted" = true AND "member_id" IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "access_events"`);
    await q.query(`DROP TABLE "devices"`);
  }
}
