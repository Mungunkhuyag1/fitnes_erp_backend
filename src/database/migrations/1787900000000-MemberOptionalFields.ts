import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Гишүүний ЗААВАЛ БИШ нэмэлт талбарууд.
 *
 * Бүгд nullable — одоо байгаа бүртгэлүүд хөндөгдөхгүй, аль нэгийг нь
 * бөглөөгүй байх нь хэвийн.
 */
export class MemberOptionalFields1787900000000 implements MigrationInterface {
  name = 'MemberOptionalFields1787900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "members"
        ADD "gender" character varying(10),
        ADD "birth_date" date,
        ADD "emergency_name" character varying(120),
        ADD "emergency_phone" character varying(20)
    `);
    // Зөвхөн мэдэгдэж буй утга орохыг баталгаажуулна (хоосон байж болно).
    await q.query(`
      ALTER TABLE "members" ADD CONSTRAINT "CK_member_gender"
        CHECK ("gender" IS NULL OR "gender" IN ('male','female','other'))
    `);
    // Төрсөн өдрийн жагсаалт сар/өдрөөр хайгддаг тул тухайн индекс.
    await q.query(`
      CREATE INDEX "IDX_member_birth_md" ON "members"
        (EXTRACT(MONTH FROM "birth_date"), EXTRACT(DAY FROM "birth_date"))
        WHERE "birth_date" IS NOT NULL
    `);
    await q.query(`CREATE INDEX "IDX_member_gender" ON "members" ("gender") WHERE "gender" IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "IDX_member_gender"`);
    await q.query(`DROP INDEX "IDX_member_birth_md"`);
    await q.query(`ALTER TABLE "members" DROP CONSTRAINT "CK_member_gender"`);
    await q.query(`
      ALTER TABLE "members"
        DROP COLUMN "emergency_phone",
        DROP COLUMN "emergency_name",
        DROP COLUMN "birth_date",
        DROP COLUMN "gender"
    `);
  }
}
