import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B8 — Нэхэмжлэх (Bonum).
 *
 * Нэг гишүүнд нэг зэрэг НЭГ л `pending` нэхэмжлэх байх дүрмийг хэсэгчилсэн
 * unique индексээр DB түвшинд барина — зэрэг ирсэн хоёр хүсэлт ч давхар
 * нэхэмжлэх үүсгэж чадахгүй.
 */
export class Invoice1787700000000 implements MigrationInterface {
  name = 'Invoice1787700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "invoices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "member_id" uuid NOT NULL,
        "package_id" uuid NOT NULL,
        "package_name" character varying(120) NOT NULL,
        "days" integer NOT NULL,
        "amount" bigint NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'pending',
        "provider" character varying(20) NOT NULL DEFAULT 'bonum',
        "transaction_id" character varying(64) NOT NULL,
        "provider_invoice_id" character varying(120),
        "pay_url" character varying(1024),
        "raw_payload" jsonb,
        "paid_at" TIMESTAMP WITH TIME ZONE,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_invoices_member" FOREIGN KEY ("member_id")
          REFERENCES "members"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_invoices_status" CHECK ("status" IN
          ('pending','paid','expired','cancelled')),
        CONSTRAINT "CK_invoices_amount" CHECK ("amount" >= 0)
      )`);

    await q.query(
      `CREATE UNIQUE INDEX "uq_invoices_txn" ON "invoices" ("transaction_id")`,
    );
    await q.query(
      `CREATE INDEX "ix_invoices_member" ON "invoices" ("member_id", "created_at" DESC)`,
    );
    await q.query(`CREATE INDEX "ix_invoices_status" ON "invoices" ("status")`);
    // PSP-ийн invoiceId-гаар ч хайна (webhook-д transactionId дутуу ирж болно).
    await q.query(`
      CREATE INDEX "ix_invoices_provider_id" ON "invoices" ("provider_invoice_id")
        WHERE "provider_invoice_id" IS NOT NULL`);

    // ★ Нэг гишүүнд нэг зэрэг НЭГ л хүлээгдэж буй нэхэмжлэх.
    await q.query(`
      CREATE UNIQUE INDEX "uq_invoices_one_pending" ON "invoices" ("member_id")
        WHERE "status" = 'pending'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "invoices"`);
  }
}
