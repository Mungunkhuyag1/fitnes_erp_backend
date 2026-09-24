import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Йог — АНГИ (курс) загвар руу шилжүүлэв.
 *
 * ★ ЯАГААД ӨМНӨХИЙГ ХАЯВ
 *
 * Эхний хувилбарт «нэг хичээл = нэг мөр» гэж загварчилсан нь бодит
 * ажиллагаатай таарсангүй. Заал нь ХИЧЭЭЛ биш АНГИ зардаг:
 *
 *     «Хатха йог · 9-р сарын 25 → 10-р сарын 25 · Дав/Лха/Баа · 12 хүн»
 *
 * Гишүүн нэг хичээлд биш, АНГИД бүртгүүлж, түүний бүх орох өдөрт
 * хамаарна. Төлбөр нь ангийнх, нэг удаагийнх биш. Хуучин загвараар
 * нэг гишүүнийг 12 өдөрт 12 удаа бүртгэх шаардлагатай байв.
 *
 * ★ ГУРВАН ХҮСНЭГТ
 *
 *   yoga_courses      — анги: хугацаа, долоо хоногийн өдрүүд, үнэ
 *   yoga_enrollments  — тэр ангид бүртгүүлсэн хүн + төлбөр
 *   yoga_attendance   — хэн, АЛЬ ӨДӨР ирсэн
 *
 * ★ ОРОЛТЫН ӨДРҮҮДИЙГ ХАДГАЛАХГҮЙ
 *
 * Хичээлийн өдрүүд нь (эхлэх, дуусах, гарагууд) гурвын ТООЦООЛОЛ.
 * Мөр болгож хадгалбал ангийн хуваарь өөрчлөгдөхөд тэдгээрийг
 * дахин үүсгэх шаардлагатай болж, ирцтэй өдрүүд эзэнгүй үлдэнэ.
 * Ирц нь ӨДРӨӨР (`session_on`) холбогдоно — хуваарь өөрчлөгдсөн ч
 * бүртгэгдсэн ирц алдагдахгүй.
 *
 * ⚠ Хуучин хүснэгтийг УСТГАНА. Энэ нь хэдхэн цагийн өмнө гарсан,
 * зөвхөн туршилтын өгөгдөлтэй байсан. Бодит ашиглалтад орсон бол
 * ийм шилжүүлэг хийхгүй байх ёстой.
 */
export class YogaCourses1788210000000 implements MigrationInterface {
  name = 'YogaCourses1788210000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "yoga_bookings"`);
    await q.query(`DROP TABLE IF EXISTS "yoga_classes"`);

    await q.query(`
      CREATE TABLE "yoga_courses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(120) NOT NULL,
        "instructor" character varying(120),
        /* Ангийн хугацаа — ОГНОО, цаггүй: бүсийн гулсалт үүсэхгүй. */
        "starts_on" date NOT NULL,
        "ends_on" date NOT NULL,
        /*
         * Долоо хоногийн аль өдрүүд. 0 = Ням … 6 = Бямба.
         * ⚠ JS-ийн «getDay()»-тай ИЖИЛ дугаарлалт — хөрвүүлэлт
         * хийхгүй тул алдаа гарах цэг цөөрнө.
         */
        "weekdays" smallint[] NOT NULL DEFAULT '{}',
        /* Хичээл эхлэх цаг — орон нутгийн, «19:00». */
        "start_time" time NOT NULL DEFAULT '19:00',
        "duration_min" integer NOT NULL DEFAULT 60,
        /* Хүний дээд тоо. NULL = хязгааргүй. */
        "capacity" integer,
        /* Ангийн ҮНЭ — нэг хүн бүтэн хугацаанд төлөх дүн. */
        "price" bigint NOT NULL DEFAULT 0,
        "note" character varying(500),
        "archived_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_yoga_courses" PRIMARY KEY ("id"),
        CONSTRAINT "ck_yoga_courses_range" CHECK ("ends_on" >= "starts_on")
      )
    `);
    await q.query(
      `CREATE INDEX "ix_yoga_courses_range" ON "yoga_courses" ("starts_on", "ends_on")`,
    );

    await q.query(`
      CREATE TABLE "yoga_enrollments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "course_id" uuid NOT NULL,
        /* ⚠ ЗААВАЛ БИШ — йогт заалны гишүүн биш хүн ирж болно. */
        "member_id" uuid,
        /*
         * Нэрийг ҮРГЭЛЖ хадгална. Гишүүн уствал (SET NULL) энэ мөр
         * хэний болох нь мэдэгдэхгүй болох ёсгүй.
         */
        "name" character varying(160) NOT NULL,
        "phone" character varying(32),
        /*
         * ★ ТӨЛБӨРИЙГ ХОЁР ТАЛБАРААР
         *
         * «amount_due»  — төлөх ёстой (ангийн үнээс өөр байж болно:
         *                 хөнгөлөлт, дундуур нэгдсэн гэх мэт)
         * «amount_paid» — өнөөдрийг хүртэл хүлээн авсан
         *
         * Үлдэгдэл = due − paid. Ганц «paid_at» тугаар илэрхийлэх
         * боломжгүй: йогийн төлбөр ХЭСЭГЧИЛЖ ордог.
         */
        "amount_due" bigint NOT NULL DEFAULT 0,
        "amount_paid" bigint NOT NULL DEFAULT 0,
        "note" character varying(500),
        "staff_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_yoga_enrollments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_yoga_enr_course" FOREIGN KEY ("course_id")
          REFERENCES "yoga_courses"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_yoga_enr_member" FOREIGN KEY ("member_id")
          REFERENCES "members"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_yoga_enr_staff" FOREIGN KEY ("staff_user_id")
          REFERENCES "staff_users"("id") ON DELETE SET NULL
      )
    `);
    await q.query(
      `CREATE INDEX "ix_yoga_enr_course" ON "yoga_enrollments" ("course_id")`,
    );
    /*
     * Нэг гишүүнийг нэг ангид хоёр удаа бүртгэхээс сэргийлнэ.
     * Нэрээр давхардлыг барих боломжгүй: «Болд» хоёр байж болно.
     */
    await q.query(
      `CREATE UNIQUE INDEX "uq_yoga_enr_member" ON "yoga_enrollments"
         ("course_id", "member_id") WHERE "member_id" IS NOT NULL`,
    );

    await q.query(`
      CREATE TABLE "yoga_attendance" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "enrollment_id" uuid NOT NULL,
        /*
         * ⚠ ӨДРӨӨР холбогдоно, хичээлийн мөрөөр БИШ. Ангийн хуваарь
         * өөрчлөгдсөн ч бүртгэгдсэн ирц эзэнгүй үлдэхгүй.
         */
        "session_on" date NOT NULL,
        "staff_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_yoga_attendance" PRIMARY KEY ("id"),
        CONSTRAINT "uq_yoga_attendance" UNIQUE ("enrollment_id", "session_on"),
        CONSTRAINT "fk_yoga_att_enr" FOREIGN KEY ("enrollment_id")
          REFERENCES "yoga_enrollments"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_yoga_att_staff" FOREIGN KEY ("staff_user_id")
          REFERENCES "staff_users"("id") ON DELETE SET NULL
      )
    `);
    await q.query(
      `CREATE INDEX "ix_yoga_att_day" ON "yoga_attendance" ("session_on")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "yoga_attendance"`);
    await q.query(`DROP TABLE IF EXISTS "yoga_enrollments"`);
    await q.query(`DROP TABLE IF EXISTS "yoga_courses"`);
  }
}
