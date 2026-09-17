import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Терминалын эрүүл мэндийн цохилт.
 *
 * ★ ЯАГААД ШИНЭ БАГАНА ХЭРЭГТЭЙ ВЭ
 *
 * `online` ба `last_seen_at` хоёр аль хэдийн байсан ч ердийн
 * ажиллагаанд ХЭЗЭЭ Ч шинэчлэгддэггүй байв — зөвхөн гараар оношлогоо
 * эсвэл хаяг хайх үед бичигддэг. Тиймээс прод дээр `online=true`,
 * `last_seen_at=2026-08-26` гэж хөлдөөд, терминал унасныг харуулах
 * ямар ч дохио байгаагүй.
 *
 * `DeviceHealthService` одоо 5 минут тутам цохилт өгнө. Гэхдээ
 * «унтарсан» гэдэг хангалтгүй — ЯАГААД гэдгийг мэдэх хэрэгтэй:
 * 530 (холбогч алга) ба 502 (терминалын IP солигдсон) хоёр огт өөр
 * засвар шаардана. Тиймээс сүүлийн алдааг хадгална.
 */
export class DeviceHealth1788120000000 implements MigrationInterface {
  name = 'DeviceHealth1788120000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "last_error" text`,
    );
    await q.query(
      `ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "last_error_at" TIMESTAMP WITH TIME ZONE`,
    );

    // ⚠ Цохилт байгаагүй тул `online` нь утгагүй үнэнийг хэлж байсан.
    // Эхний шалгалт хүртэл «мэдэхгүй» гэсэн төлөвт байлгая — худал
    // ногооноос хоосон нь дээр.
    await q.query(
      `UPDATE "devices" SET "online" = false WHERE "last_seen_at" < now() - interval '1 day'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "devices" DROP COLUMN IF EXISTS "last_error_at"`);
    await q.query(`ALTER TABLE "devices" DROP COLUMN IF EXISTS "last_error"`);
  }
}
