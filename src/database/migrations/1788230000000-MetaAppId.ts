import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Facebook аппын ID.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ — ТОКЕН ЧИМЭЭГҮЙ ҮХДЭГ
 *
 * Page access token нь ихэвчлэн 60 ХОНОГТ хугацаа дуусдаг. Тэр үед
 * юу ч мэдэгдэхгүй: webhook ирсээр байна, гэвч хариу илгээх бүрд
 * Meta 190 алдаа буцаана. Ажилтан «яагаад хариу явахгүй байна» гэж
 * гайхна, админ хэдэн долоо хоногийн дараа санамсаргүй олно.
 *
 * Meta-гийн `/debug_token` нь токен ХЭЗЭЭ дуусахыг УРЬДЧИЛАН хэлнэ
 * (`expires_at = 0` бол хэзээ ч дуусахгүй). Гэвч тэр дуудлага нь
 * АППЫН токен шаарддаг:
 *
 *     access_token = «<app_id>|<app_secret>»
 *
 * `app_secret` аль хэдийн хадгалагддаг ч `app_id` байгаагүй тул
 * шалгах боломжгүй байв.
 *
 * ⚠ НУУЦ БИШ. App ID нь клиент талын кодод ил тавигддаг нийтийн
 * утга — тиймээс битүүмжлэхгүй, энгийн баганад. Нууц нь зөвхөн
 * `app_secret`, тэр нь хэвээр битүүмжлэгдсэн.
 *
 * ⚠ Заавал биш: `app_id` өгөөгүй бол холболт ажиллана, зөвхөн
 * хугацаа дуусах анхааруулга байхгүй болно.
 */
export class MetaAppId1788230000000 implements MigrationInterface {
  name = 'MetaAppId1788230000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "meta_pages" ADD COLUMN IF NOT EXISTS "app_id" character varying(40)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "meta_pages" DROP COLUMN IF EXISTS "app_id"`);
  }
}
