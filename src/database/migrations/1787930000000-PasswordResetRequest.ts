import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Нууц үг сэргээх ХҮСЭЛТ.
 *
 * ЯАГААД ТОКЕН БИШ, ХҮСЭЛТ ВЭ:
 *
 * Сонгодог «сэргээх линк» урсгалд и-мэйл илгээх дэд бүтэц шаардлагатай.
 * Энэ систем и-мэйл илгээдэггүй бөгөөд фитнесийн ажилтан 3-20 хүн, бүгд
 * нэг байранд ажилладаг. Тиймээс:
 *
 *   1. Ажилтан «мартсан» гэж хүсэлт үлдээнэ
 *   2. Админ жагсаалтаас хараад ТҮР НУУЦ ҮГ тавьж, амаар дамжуулна
 *   3. Ажилтан эхний нэвтрэлтэд заавал солино
 *
 * Ингэснээр и-мэйл сервергүйгээр бүрэн ажиллах ба линк алдагдах,
 * хугацаа дуусах зэрэг эрсдэл ч байхгүй.
 */
export class PasswordResetRequest1787930000000 implements MigrationInterface {
  name = 'PasswordResetRequest1787930000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "password_reset_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying(160) NOT NULL,
        "staff_user_id" uuid,
        "note" character varying(300),
        "ip" character varying(64),
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "resolved_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_password_reset_requests" PRIMARY KEY ("id")
      )
    `);
    // Шийдэгдээгүй хүсэлтийг хурдан олох — админы дэлгэц үүгээр шүүнэ.
    await q.query(`
      CREATE INDEX "IDX_prr_open" ON "password_reset_requests" ("created_at")
        WHERE "resolved_at" IS NULL
    `);
    // Нэг и-мэйлээс ОЛОН нээлттэй хүсэлт үүсгэхийг хориглоно: дахин дахин
    // дарахад жагсаалт хогдож, админ жинхэнэ хүсэлтийг олохгүй болно.
    await q.query(`
      CREATE UNIQUE INDEX "uq_prr_open_email" ON "password_reset_requests" ("email")
        WHERE "resolved_at" IS NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "password_reset_requests"`);
  }
}
