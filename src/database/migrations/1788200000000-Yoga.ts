import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Йогийн анги ба оролцогчид — ФИТНЕСЭЭС ТУСДАА бүртгэл.
 *
 * ★ ЯАГААД ТУСДАА ХҮСНЭГТ, ГИШҮҮНЧЛЭЛ БИШ
 *
 * Йог нь заалны эрхтэй огт өөр бүтээгдэхүүн:
 *
 *   • Хугацаагаар БИШ, ХИЧЭЭЛЭЭР зарагдана
 *   • Оролцогч нь WinFit-ийн гишүүн БАЙХ албагүй — гаднаас ирж болно
 *   • Терминал огт оролцохгүй: админ хаалгыг ӨӨРӨӨ нээж өгдөг
 *
 * Хэрэв үүнийг `memberships`-д шахвал `recompute()` нь йогийн хоногийг
 * заалны эрх дээр НЭМЭХ бөгөөд йог авсан хүн заалны эрхтэй болно.
 * Тусдаа хүснэгт нь тэр холилдоод сүйрэхээс сэргийлнэ.
 *
 * ⚠ Энэ нь `docs/15`-д шинжилсэн «үйлчилгээ + эрх» гэсэн ТОМ загвараас
 * зориуд ялгаатай. Тэр загвар нь терминал дээр эрхийг салгах гэсэн
 * оролдлогоос үүдэлтэй байв. Захиалагч «терминал дээр бүртгэл үүсгэх
 * ямар ч хэрэг байхгүй» гэж тодруулсан тул тэр бүх нарийн бүтэц
 * шаардлагагүй болсон.
 */
export class Yoga1788200000000 implements MigrationInterface {
  name = 'Yoga1788200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "yoga_classes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" character varying(120) NOT NULL,
        /* Багшийн нэр — ажилтны данстай холбохгүй: йогийн багш нь
           гаднаас ирдэг, WinFit-д хэрэглэгч байхгүй байж болно. */
        "instructor" character varying(120),
        "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "duration_min" integer NOT NULL DEFAULT 60,
        /* Хүний дээд тоо. NULL = хязгааргүй. */
        "capacity" integer,
        /* Нэг хүний ердийн төлбөр — бүртгэх бүрд гараар өөрчилж болно. */
        "price" bigint NOT NULL DEFAULT 0,
        "note" character varying(500),
        /* Цуцалсан анги. УСТГАХГҮЙ — төлсөн хүмүүсийн бүртгэл үлдэнэ. */
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_yoga_classes" PRIMARY KEY ("id")
      )
    `);
    await q.query(
      `CREATE INDEX "ix_yoga_classes_starts" ON "yoga_classes" ("starts_at")`,
    );

    await q.query(`
      CREATE TABLE "yoga_bookings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "class_id" uuid NOT NULL,
        /*
         * ⚠ Гишүүнтэй холбоос нь ЗААВАЛ БИШ. Йогт заалны гишүүн биш
         * хүн ирж болно. Холбогдсон бол гишүүний дэлгэцээс түүхийг нь
         * харах боломжтой болно.
         */
        "member_id" uuid,
        /*
         * Нэрийг ҮРГЭЛЖ хадгална — гишүүнтэй холбогдсон ч гэсэн.
         * Гишүүн уствал энэ мөр хэний болох нь мэдэгдэхгүй болох ёсгүй.
         */
        "name" character varying(160) NOT NULL,
        "phone" character varying(32),
        "amount" bigint NOT NULL DEFAULT 0,
        /* NULL = мөнгө аваагүй (авлага). Гишүүнчлэлтэй ижил дүрэм. */
        "paid_at" TIMESTAMP WITH TIME ZONE,
        /* Ирсэн эсэх — хичээл болсны дараа админ тэмдэглэнэ. */
        "attended_at" TIMESTAMP WITH TIME ZONE,
        "note" character varying(500),
        "staff_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_yoga_bookings" PRIMARY KEY ("id"),
        CONSTRAINT "fk_yoga_bookings_class" FOREIGN KEY ("class_id")
          REFERENCES "yoga_classes"("id") ON DELETE CASCADE,
        /* Гишүүнийг устгавал бүртгэл нь үлдэнэ, зөвхөн холбоос тасарна. */
        CONSTRAINT "fk_yoga_bookings_member" FOREIGN KEY ("member_id")
          REFERENCES "members"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_yoga_bookings_staff" FOREIGN KEY ("staff_user_id")
          REFERENCES "staff_users"("id") ON DELETE SET NULL
      )
    `);
    await q.query(
      `CREATE INDEX "ix_yoga_bookings_class" ON "yoga_bookings" ("class_id")`,
    );
    await q.query(
      `CREATE INDEX "ix_yoga_bookings_member" ON "yoga_bookings" ("member_id")
         WHERE "member_id" IS NOT NULL`,
    );

    /*
     * ⚠ Нэг хүнийг нэг ангид ХОЁР удаа бүртгэхээс сэргийлнэ — зөвхөн
     * гишүүнтэй холбогдсон үед. Нэрээр давхардлыг барих боломжгүй:
     * «Болд» гэсэн хоёр өөр хүн байж болно.
     */
    await q.query(
      `CREATE UNIQUE INDEX "uq_yoga_booking_member" ON "yoga_bookings"
         ("class_id", "member_id") WHERE "member_id" IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "yoga_bookings"`);
    await q.query(`DROP TABLE IF EXISTS "yoga_classes"`);
  }
}
