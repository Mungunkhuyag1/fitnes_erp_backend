import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Урамшуулал — давхарлах ба багцад чиглүүлэх.
 *
 * ★ «НЭГ ҮЕД НЭГ Л» ДҮРЭМ ЦУЦЛАГДАВ
 *
 * Өмнө нь `uq_promotion_active` нь нэг л идэвхтэй мөр зөвшөөрдөг байв.
 * Одоо олон урамшуулал зэрэг явж, тохирсон нь бүгд ДАВХАРЛАНА.
 *
 * ★ ОНЦГОЙ УРАМШУУЛАЛ
 *
 * `exclusive` нь давхарлахыг зогсооно: онцгой урамшуулал тохирвол
 * зөвхөн тэр үйлчилнэ («Хар баасан 50%» гэх мэт). `fixed_price` нь
 * утга учрын хувьд ҮРГЭЛЖ онцгой — «үнэ нь 500,000₮» гэж зарлаад
 * дээрээс нь дахин хямдруулах нь өөрийгөө няцаана.
 *
 * ★ НЭХЭМЖЛЭХ ОЛОН УРАМШУУЛАЛТАЙ
 *
 * `invoices.promotion_id` (ганц) → `invoice_promotions` (олон мөр).
 * Мөр бүр нь ХЭДЭН ТӨГРӨГ хөнгөлснийг үүсэх агшинд хадгална — өмнө нь
 * төлөгдөх агшинд багцын үнээс дахин тооцдог байсан нь багцын үнэ
 * завсарт өөрчлөгдвөл буруу тоо бүртгэдэг байв.
 */
export class PromotionStacking1788130000000 implements MigrationInterface {
  name = 'PromotionStacking1788130000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Олон идэвхтэй урамшуулал ──
    await q.query(`DROP INDEX IF EXISTS "uq_promotion_active"`);
    await q.query(
      `CREATE INDEX "ix_promotion_active" ON "promotions" ("active") WHERE "active"`,
    );

    await q.query(
      `ALTER TABLE "promotions" ADD "exclusive" boolean NOT NULL DEFAULT false`,
    );
    // Давхарлах дараалал ба онцгой урамшууллын эрэмбэ. `packages`-тай
    // ижил нэршил — нэг л хэлц дээр яримаар.
    await q.query(
      `ALTER TABLE "promotions" ADD "sort_order" integer NOT NULL DEFAULT 0`,
    );
    // Тогтмол үнэ нь давхарлахгүй — доорх `CK` үүнийг барина.
    await q.query(
      `UPDATE "promotions" SET "exclusive" = true WHERE "kind" = 'fixed_price'`,
    );
    await q.query(
      `ALTER TABLE "promotions" ADD CONSTRAINT "CK_promotions_fixed_exclusive" ` +
        `CHECK ("kind" <> 'fixed_price' OR "exclusive")`,
    );

    // ── Нэхэмжлэх бүрийн урамшууллын ХУУЛБАР ──
    await q.query(`
      CREATE TABLE "invoice_promotions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "invoice_id" uuid NOT NULL,
        "promotion_id" uuid NOT NULL,
        "kind" character varying(12) NOT NULL,
        "value_applied" bigint NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "pk_invoice_promotions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_invoice_promotion" UNIQUE ("invoice_id", "promotion_id")
      )`);
    await q.query(
      `CREATE INDEX "ix_invoice_promotions_invoice" ON "invoice_promotions" ("invoice_id")`,
    );

    // Хуучин мөрүүдийг хөрвүүлнэ. `value_applied`-ийг ӨМНӨХ кодтой яг
    // ижлээр (багцын үнэ хасах нэхэмжлэхийн дүн) тооцоолно — тоо нь
    // өөрчлөгдөхгүй.
    await q.query(`
      INSERT INTO "invoice_promotions"
        ("invoice_id", "promotion_id", "kind", "value_applied", "sort_order")
      SELECT i."id", i."promotion_id", p."kind",
        CASE
          WHEN p."kind" = 'bonus_days'
            THEN GREATEST(0, i."days" - COALESCE(pk."days", i."days"))
          ELSE GREATEST(0, COALESCE(pk."price", i."amount") - i."amount")
        END,
        0
      FROM "invoices" i
      JOIN "promotions" p ON p."id" = i."promotion_id"
      LEFT JOIN "packages" pk ON pk."id" = i."package_id"
      WHERE i."promotion_id" IS NOT NULL`);

    await q.query(`ALTER TABLE "invoices" DROP COLUMN "promotion_id"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "invoices" ADD "promotion_id" uuid`);
    // Олноос нэгийг л буцаана — хамгийн түрүүнд хэрэглэгдсэнийг.
    await q.query(`
      UPDATE "invoices" i SET "promotion_id" = sub."promotion_id"
      FROM (
        SELECT DISTINCT ON ("invoice_id") "invoice_id", "promotion_id"
        FROM "invoice_promotions" ORDER BY "invoice_id", "sort_order"
      ) sub
      WHERE sub."invoice_id" = i."id"`);
    await q.query(`DROP TABLE "invoice_promotions"`);

    await q.query(
      `ALTER TABLE "promotions" DROP CONSTRAINT "CK_promotions_fixed_exclusive"`,
    );
    await q.query(`ALTER TABLE "promotions" DROP COLUMN "sort_order"`);
    await q.query(`ALTER TABLE "promotions" DROP COLUMN "exclusive"`);

    // ⚠ Хуучин unique индексийг сэргээхийн ӨМНӨ нэгээс бусдыг унтраана —
    // эс бөгөөс индекс үүсэхгүй бөгөөд migration дунд замдаа унана.
    await q.query(`
      UPDATE "promotions" SET "active" = false
      WHERE "active" AND "id" <> (
        SELECT "id" FROM "promotions" WHERE "active"
        ORDER BY "created_at" LIMIT 1
      )`);
    await q.query(`DROP INDEX IF EXISTS "ix_promotion_active"`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_promotion_active" ON "promotions" ((true)) WHERE "active"`,
    );
  }
}
