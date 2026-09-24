import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Йогийн төлбөрийн БҮРТГЭЛ — хэзээ, хэдийг авсан.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * `yoga_enrollments.amount_paid` нь «нийт хэд орсон» гэдгийг хэлнэ ч
 * ХЭЗЭЭ орсныг хэлэхгүй. Тэгэхээр:
 *
 *   • «Өнөөдрийн орлого»-д йогийн мөнгийг оруулах боломжгүй
 *   • Тайлангийн хугацааны муж утгагүй болно
 *   • Кассын тулгалт хийх аргагүй
 *
 * Мөнгө ХЭСЭГЧИЛЖ ордог тул нэг `paid_at` талбар ч хангахгүй: 100,000
 * өнөөдөр, 150,000 дараа долоо хоногт орж болно.
 *
 * ★ `amount_paid` ХЭВЭЭР ҮЛДЭНЭ
 *
 * Мөрүүдийн нийлбэрээр бодох ч болно, гэвч гишүүдийн жагсаалт болгонд
 * нэмэлт нийлбэр хийх нь дэмий. `amount_paid` нь КЭШ — төлбөр нэмэх
 * бүрд хамт шинэчлэгдэнэ.
 *
 * ⚠ Одоо байгаа `amount_paid` утгуудыг мөр болгон нөхнө. Огноог нь
 * мэдэхгүй тул бүртгүүлсэн өдрөөр (`created_at`) тавина — тэр нь
 * бодитод хамгийн ойр таамаг.
 */
export class YogaPayments1788220000000 implements MigrationInterface {
  name = 'YogaPayments1788220000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "yoga_payments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "enrollment_id" uuid NOT NULL,
        "amount" bigint NOT NULL,
        /* Мөнгө ХЭЗЭЭ орсон — тайлан үүгээр бүлэглэнэ. */
        "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "staff_user_id" uuid,
        "note" character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_yoga_payments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_yoga_pay_enr" FOREIGN KEY ("enrollment_id")
          REFERENCES "yoga_enrollments"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_yoga_pay_staff" FOREIGN KEY ("staff_user_id")
          REFERENCES "staff_users"("id") ON DELETE SET NULL
      )
    `);
    await q.query(
      `CREATE INDEX "ix_yoga_pay_date" ON "yoga_payments" ("paid_at")`,
    );
    await q.query(
      `CREATE INDEX "ix_yoga_pay_enr" ON "yoga_payments" ("enrollment_id")`,
    );

    /*
     * Байгаа төлбөрийг нөхнө. Огноог нь мэдэхгүй тул бүртгүүлсэн
     * өдрөөр — эс бөгөөс тайлан дээр эдгээр мөнгө ХЭЗЭЭ Ч харагдахгүй.
     */
    await q.query(
      `INSERT INTO "yoga_payments" ("enrollment_id", "amount", "paid_at", "staff_user_id")
         SELECT id, amount_paid, created_at, staff_user_id
           FROM "yoga_enrollments"
          WHERE amount_paid > 0`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "yoga_payments"`);
  }
}
