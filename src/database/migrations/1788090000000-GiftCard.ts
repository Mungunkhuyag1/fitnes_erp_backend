import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Бэлгийн карт.
 *
 * ★ ХУГАЦААГ ХАДГАЛАХГҮЙ
 *
 * Дуусах огноо нь Loopy дээр программд тохируулсанаар үйлчилнэ. Хоёр
 * газар хадгалбал заавал зөрнө — нэг л газар байх нь зөв.
 *
 * ★ ИДЭВХЖҮҮЛЭЛТ ГАРААР
 *
 * Хүлээн авагч ресепшн дээр Loopy апп-аар уншуулна, ажилтан эрхийг
 * гараар сунгаад картыг «ашигласан» болгоно. Тиймээс үлдэгдлийн
 * дэвтэр, кодын генератор хэрэггүй.
 */
export class GiftCard1788090000000 implements MigrationInterface {
  name = 'GiftCard1788090000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "gift_cards" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "amount" bigint NOT NULL,
        "recipient_name" character varying(120) NOT NULL,
        "recipient_phone" character varying(20) NOT NULL,
        "buyer_name" character varying(120),
        "note" character varying(300),
        "status" character varying(10) NOT NULL DEFAULT 'issued',
        "loopy_card_serial" character varying(64),
        "loopy_linked_at" TIMESTAMP WITH TIME ZONE,
        "issued_by" uuid,
        "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "used_by" uuid,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "used_member_id" uuid,
        CONSTRAINT "pk_gift_cards" PRIMARY KEY ("id"),
        CONSTRAINT "CK_gift_cards_status"
          CHECK (status IN ('issued','enrolled','used','cancelled')),
        CONSTRAINT "CK_gift_cards_amount" CHECK (amount > 0)
      )`);
    // Нэг дугаарт нэг л ИДЭВХТЭЙ бэлгийн карт — хоёр карт зэрэг байвал
    // enroll хийсэн картыг аль нэгд нь тааруулах боломжгүй болно.
    await q.query(
      `CREATE UNIQUE INDEX "uq_gift_open_phone" ON "gift_cards" ("recipient_phone") ` +
        `WHERE "status" IN ('issued','enrolled')`,
    );
    await q.query(`CREATE INDEX "ix_gift_status" ON "gift_cards" ("status")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "gift_cards"`);
  }
}
