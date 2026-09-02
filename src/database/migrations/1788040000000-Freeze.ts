import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чөлөө — баярын (бүх гишүүн) ба хувь хүний.
 *
 * ★ ХОЁР ХҮСНЭГТ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * `freeze_applications` дээрх UNIQUE нь идемпотент байдлыг DB ТҮВШИНД
 * барина. Үүнгүйгээр баярын чөлөөг санамсаргүй хоёр удаа дарахад бүх
 * гишүүн ДАВХАР хоног авна — тэр алдаа чимээгүй өнгөрч, сарын дараа
 * «яагаад бүгд илүү хоногтой байна вэ» гэж гайхна.
 */
export class Freeze1788040000000 implements MigrationInterface {
  name = 'Freeze1788040000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "freezes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope" character varying(8) NOT NULL,
        "member_id" uuid,
        "reason" character varying(200) NOT NULL,
        "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "days" integer NOT NULL,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "ended_at" TIMESTAMP WITH TIME ZONE,
        "ended_by" uuid,
        CONSTRAINT "pk_freezes" PRIMARY KEY ("id")
      )`);
    // «Дуусаагүй хувь хүний чөлөө» — өдөр бүрийн ажил үүнийг хайна.
    await q.query(
      `CREATE INDEX "ix_freezes_open" ON "freezes" ("ends_at") WHERE "ended_at" IS NULL`,
    );
    await q.query(`CREATE INDEX "ix_freezes_member" ON "freezes" ("member_id")`);

    await q.query(`
      CREATE TABLE "freeze_applications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "freeze_id" uuid NOT NULL,
        "member_id" uuid NOT NULL,
        "days_added" integer NOT NULL,
        "membership_id" uuid,
        "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_freeze_applications" PRIMARY KEY ("id")
      )`);
    // ★ ЭНЭ МӨР БҮХНИЙГ ШИЙДНЭ — давхар олголтоос сэргийлнэ.
    await q.query(
      `CREATE UNIQUE INDEX "uq_freeze_app" ON "freeze_applications" ("freeze_id", "member_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "freeze_applications"`);
    await q.query(`DROP TABLE "freezes"`);
  }
}
