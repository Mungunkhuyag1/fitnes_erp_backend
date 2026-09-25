import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Webhook ХЭЗЭЭ ирснийг бүртгэх.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ — «МЕССЕЖ ИРЭХГҮЙ БАЙНА» ГЭДЭГ НЬ ГУРВАН ӨӨР АСУУДАЛ
 *
 * Тохиргоо дууссаны дараа чат хоосон байвал шалтгааныг ялгах арга
 * байдаггүй байв:
 *
 *   1. Meta бидэн рүү ОГТ хандахгүй байна
 *      → Callback URL бүртгэгдээгүй, эсвэл баталгаажаагүй
 *   2. Хандаж байгаа ч ГАРЫН ҮСЭГ таарахгүй → 401
 *      → App secret буруу
 *   3. Хандаж, хүлээж авч байгаа ч мессеж хадгалагдахгүй
 *      → өөр алдаа
 *
 * Гурвуулаа дэлгэц дээр ЯГ ИЖИЛ харагдана: хоосон чат. Ажилтан
 * Meta-гийн самбар, токен, эрх гурвыг ээлжлэн хөндөж цаг алддаг.
 *
 * Хоёр талбар үүнийг таслана: «хэзээ ч ирээгүй» нь (1), «ирсэн ч
 * алдаатай» нь (2), «ирсэн, алдаагүй» нь (3).
 *
 * ⚠ Гарын үсэг шалгахаас ӨМНӨ бичигдэнэ — эс бөгөөс (2) нь (1) шиг
 * харагдана, тэр нь яг ялгах гэж байгаа зүйл маань.
 */
export class MetaWebhookSeen1788240000000 implements MigrationInterface {
  name = 'MetaWebhookSeen1788240000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "meta_pages"
         ADD COLUMN IF NOT EXISTS "last_webhook_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(
      `ALTER TABLE "meta_pages"
         ADD COLUMN IF NOT EXISTS "last_webhook_error" character varying(300)`,
    );
    /* Хаягийн баталгаажуулалт (GET) нь POST-оос ӨМНӨ болдог тул
     * тусад нь: «баталгаажсан ч мессеж ирэхгүй» гэдэг нь захиалгын
     * асуудал гэсэн үг. */
    await q.query(
      `ALTER TABLE "meta_pages"
         ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "meta_pages" DROP COLUMN IF EXISTS "verified_at"`);
    await q.query(
      `ALTER TABLE "meta_pages" DROP COLUMN IF EXISTS "last_webhook_error"`,
    );
    await q.query(
      `ALTER TABLE "meta_pages" DROP COLUMN IF EXISTS "last_webhook_at"`,
    );
  }
}
