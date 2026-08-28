import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Гишүүний РЕГИСТР ба ЗУРАГ.
 *
 * Терминалаас импортлоход хоёр зүйл гарч ирэв:
 *
 *  1. **Регистр** — терминал дээр нэр нь «Boldkhuu ayu93110115» гэж
 *     нэр+регистр хосолсон байдаг (339-өөс 180-д). Нэрэн дотор
 *     үлдээвэл хайлт, эрэмбэ, картын бичиг бүгд бохирдоно.
 *
 *  2. **Зураг** — терминалын `faceURL` нь ДОТООД хаяг
 *     (`http://192.168.0.106/LOCALS/...`). Түүнийг хадгалж болохгүй:
 *     IP солигдох, терминал сольсон, сүлжээнээс гарахад утгагүй болно.
 *     Тиймээс зургийг ӨӨРИЙГ нь татаж хадгална.
 *
 * `register` нь UNIQUE БИШ: терминал дээр давхардсан, буруу бичигдсэн
 * утга байж болзошгүй бөгөөд импортыг тэр шалтгаанаар зогсоох нь буруу.
 * Давхардлыг тайлан дээр харуулна.
 */
export class MemberRegisterPhoto1787980000000 implements MigrationInterface {
  name = 'MemberRegisterPhoto1787980000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "members"
        ADD COLUMN "register"   varchar(20),
        ADD COLUMN "photo_path" varchar(300),
        ADD COLUMN "photo_at"   timestamptz
    `);
    // Хайлтад — регистрээр хүн олох нь ресепшний түгээмэл хэрэгцээ.
    await q.query(
      `CREATE INDEX "ix_members_register" ON "members" ("register")
         WHERE "register" IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "ix_members_register"`);
    await q.query(`
      ALTER TABLE "members"
        DROP COLUMN "register",
        DROP COLUMN "photo_path",
        DROP COLUMN "photo_at"
    `);
  }
}
