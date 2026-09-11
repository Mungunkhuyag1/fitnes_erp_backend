import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Нэхэмжлэхэд ямар урамшуулал хэрэглэснийг тэмдэглэнэ.
 *
 * Төлөгдөх агшинд гишүүнчлэл үүсгэхдээ бүртгэл хийхэд хэрэгтэй —
 * тэр үед урамшуулал аль хэдийн дууссан байж болно.
 */
export class InvoicePromotion1788080000000 implements MigrationInterface {
  name = 'InvoicePromotion1788080000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "invoices" ADD "promotion_id" uuid`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "invoices" DROP COLUMN "promotion_id"`);
  }
}
