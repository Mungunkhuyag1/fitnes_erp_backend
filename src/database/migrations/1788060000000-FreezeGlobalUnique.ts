import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Нэг хугацаанд НЭГ л баярын чөлөө.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * `freeze_applications`-ийн UNIQUE нь ИЖИЛ чөлөөг дахин олгохоос
 * хамгаална. Гэвч ажилтан товчийг хоёр удаа дарвал ХОЁР ӨӨР чөлөө
 * үүсч, гишүүн бүр 2 хоног авна — тэр нь илүү магадлалтай алдаа
 * («дарагдсан уу? дахин дарья»).
 *
 * Туршилтаар батлагдсан: хоёр дарахад 80 + 79 = 159 олголт үүссэн.
 */
export class FreezeGlobalUnique1788060000000 implements MigrationInterface {
  name = 'FreezeGlobalUnique1788060000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE UNIQUE INDEX "uq_freeze_global_range" ON "freezes" ` +
        `("starts_at", "ends_at") WHERE "scope" = 'global'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "uq_freeze_global_range"`);
  }
}
