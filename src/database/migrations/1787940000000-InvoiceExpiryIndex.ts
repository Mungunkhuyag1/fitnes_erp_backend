import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Хугацаа дуусгах шүүлтийн индекс.
 *
 * Шүүлт нь 30 секунд тутам ажиллаж `status='pending' AND expires_at < now()`
 * гэж хайдаг. `ix_invoices_status` дангаараа хангалтгүй: `pending` мөр олон
 * байх тусам бүгдийг нь уншина.
 *
 * ХЭСЭГЧИЛСЭН индекс (`WHERE status='pending'`) нь зөвхөн нээлттэй
 * нэхэмжлэхийг агуулна — төлөгдсөн, хугацаа дууссан мөрүүд индекст ОРОХГҮЙ
 * тул хэмжээ нь жижиг хэвээр байна.
 */
export class InvoiceExpiryIndex1787940000000 implements MigrationInterface {
  name = 'InvoiceExpiryIndex1787940000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE INDEX "ix_invoices_expiring" ON "invoices" ("expires_at")
        WHERE "status" = 'pending'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "ix_invoices_expiring"`);
  }
}
