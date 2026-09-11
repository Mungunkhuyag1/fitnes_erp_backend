import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Хосын багц — нэг төлбөр, хоёр гишүүн.
 *
 * ★ ЯАГААД ХОЁР ГИШҮҮНЧЛЭЛ ВЭ
 *
 * «Нэг гишүүн = нэг гишүүнчлэл» гэсэн таамаг систем даяар үйлчилдэг:
 * сунгалт, терминалын бичилт, Loopy карт, тайлан бүгд түүнд тулгуурладаг.
 * Нэг гишүүнчлэлд хоёр хүн заавал бол тэр бүхнийг өөрчлөх шаардлагатай
 * болно. Оронд нь нэхэмжлэхэд хоёр гишүүнийг холбож, төлөгдмөгц ТУС
 * БҮРД нь өөрийн мөр үүсгэнэ — дүнг хагаслана.
 */
export class CoupleInvoice1788100000000 implements MigrationInterface {
  name = 'CoupleInvoice1788100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "invoice_members" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "invoice_id" uuid NOT NULL,
        "member_id" uuid NOT NULL,
        "seat_no" integer NOT NULL,
        CONSTRAINT "pk_invoice_members" PRIMARY KEY ("id"),
        CONSTRAINT "fk_invoice_members_invoice"
          FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE
      )`);
    // Нэг нэхэмжлэхэд нэг гишүүн НЭГ л удаа — «өөртэйгөө хос» болохоос
    // сэргийлнэ.
    await q.query(
      `CREATE UNIQUE INDEX "uq_invoice_member" ON "invoice_members" ("invoice_id", "member_id")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_invoice_seat" ON "invoice_members" ("invoice_id", "seat_no")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "invoice_members"`);
  }
}
