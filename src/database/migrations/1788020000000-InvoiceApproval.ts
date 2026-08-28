import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Баримт шалгах шаардлагатай төлбөр — эрх нь ГАРААР нээгдэнэ.
 *
 * Хөнгөлөлттэй багц (оюутан, ахмад, хотхон) онлайнаар төлөгдөж болно,
 * гэвч эрх АВТОМАТААР нээгдэхгүй: хэрэглэгч ресепшн дээр үнэмлэхээ
 * үзүүлж, ажилтан баталснаар л гишүүнчлэл үүснэ.
 *
 * ⚠ Гишүүнчлэлийг БАТЛАХ агшинд үүсгэдэг нь санаатай — төлсөн агшинд
 * үүсгэвэл Баасан гарагт төлж Даваа гарагт ирсэн хүн 3 хоногоо алдана.
 */
export class InvoiceApproval1788020000000 implements MigrationInterface {
  name = 'InvoiceApproval1788020000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "invoices" ADD "needs_approval" boolean NOT NULL DEFAULT false`,
    );
    await q.query(`ALTER TABLE "invoices" ADD "approved_at" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "invoices" ADD "approved_by" uuid`);
    await q.query(`ALTER TABLE "invoices" ADD "approval_note" character varying(300)`);
    // «Хүлээгдэж буй» жагсаалт нь ажилтны нүүрэнд гарна — индекстэй байх ёстой.
    await q.query(
      `CREATE INDEX "ix_invoices_awaiting" ON "invoices" ("needs_approval") WHERE "needs_approval" AND "approved_at" IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "ix_invoices_awaiting"`);
    await q.query(`ALTER TABLE "invoices" DROP COLUMN "approval_note"`);
    await q.query(`ALTER TABLE "invoices" DROP COLUMN "approved_by"`);
    await q.query(`ALTER TABLE "invoices" DROP COLUMN "approved_at"`);
    await q.query(`ALTER TABLE "invoices" DROP COLUMN "needs_approval"`);
  }
}
