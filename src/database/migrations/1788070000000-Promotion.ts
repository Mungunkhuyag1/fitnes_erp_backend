import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Урамшуулал.
 *
 * ★ НЭГ ҮЕД НЭГ Л ИДЭВХТЭЙ
 *
 * Энэ дүрэм нь загварыг эрс хялбарчилна: давхарлах эрэмбэ, «аль нь
 * ашигтай вэ» гэсэн тооцоолол бүгд хэрэггүй болно.
 *
 * ⚠ Дүрмийг ЗӨВХӨН дэлгэц дээр барих нь хангалтгүй: хоёр ажилтан зэрэг
 * идэвхжүүлэхэд хоёулаа идэвхтэй болно. DB түвшинд барина.
 */
export class Promotion1788070000000 implements MigrationInterface {
  name = 'Promotion1788070000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "promotions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(120) NOT NULL,
        "kind" character varying(12) NOT NULL,
        "value" bigint NOT NULL,
        "package_ids" uuid array NOT NULL DEFAULT '{}',
        "starts_at" TIMESTAMP WITH TIME ZONE,
        "ends_at" TIMESTAMP WITH TIME ZONE,
        "channels" text array NOT NULL DEFAULT '{online,reception}',
        "active" boolean NOT NULL DEFAULT false,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_promotions" PRIMARY KEY ("id"),
        CONSTRAINT "CK_promotions_kind"
          CHECK (kind IN ('percent','amount','fixed_price','bonus_days'))
      )`);

    // ★ НЭГ Л идэвхтэй мөр. `((true))` нь бүх идэвхтэй мөрийг НЭГ
    // түлхүүрт буулгаж, хоёр дахийг нь DB зогсооно.
    await q.query(
      `CREATE UNIQUE INDEX "uq_promotion_active" ON "promotions" ((true)) WHERE "active"`,
    );

    await q.query(`
      CREATE TABLE "promotion_redemptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "promotion_id" uuid NOT NULL,
        "membership_id" uuid,
        "member_id" uuid NOT NULL,
        "invoice_id" uuid,
        "kind" character varying(12) NOT NULL,
        "value_applied" bigint NOT NULL,
        "redeemed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_promotion_redemptions" PRIMARY KEY ("id")
      )`);
    // Нэг гишүүнчлэлд нэг урамшуулал — давхар бүртгэлээс сэргийлнэ.
    await q.query(
      `CREATE UNIQUE INDEX "uq_promo_redemption" ON "promotion_redemptions" ` +
        `("promotion_id", "membership_id") WHERE "membership_id" IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX "ix_promo_redemption_at" ON "promotion_redemptions" ("redeemed_at")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "promotion_redemptions"`);
    await q.query(`DROP TABLE "promotions"`);
  }
}
