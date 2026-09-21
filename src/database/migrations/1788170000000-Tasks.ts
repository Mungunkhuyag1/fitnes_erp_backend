import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ТӨЛӨВЛӨГӨӨТ АЖИЛ — ажилтнуудын дотоод даалгавар.
 *
 * ★ ХОЁР ХҮСНЭГТ, ЯАГААД
 *
 * Давтагдах ажлын «тохиолдол» бүрийг урьдчилж мөр болгож үүсгэдэг
 * загварыг ЗОРИУДААР сонгоогүй. Тэр нь гурван асуудал дагуулдаг:
 *
 *   1. Хэдэн жилийн цаад мөрийг үүсгэх вэ? Хязгаар тавибал хэн нэгэн
 *      түүнээс цааш харах үед хоосон харагдана.
 *   2. Давталтын дүрмийг өөрчлөхөд аль хэдийн үүссэн мөрүүдийг
 *      ЗАСАХ ЭСВЭЛ УСТГАХ хэрэгтэй болно — гүйцэтгэсэн тэмдэглэгээ нь
 *      тэдэн дээр байвал алдагдана.
 *   3. Мөр үүсгэгч тогтмол ажил (cron) нэмэгдэнэ — унтарвал ажил алга
 *      болно, хэн ч анзаарахгүй.
 *
 * Оронд нь: `tasks` нь ДҮРЭМ, `task_completions` нь ГҮЙЦЭТГЭЛ. Календарь
 * нээхэд тухайн мужийн огноонуудыг дүрмээс нь ТООЦНО. Дүрэм өөрчлөгдвөл
 * ирээдүй нь тэр даруй өөрчлөгдөж, өнгөрсний тэмдэглэгээ хэвээр үлдэнэ.
 *
 * ★ ОГНОО НЬ `date`, `timestamptz` БИШ
 *
 * «2026-09-22-ны ажил» гэдэг нь хуанлийн ӨДӨР — цаг бүсээс хамаарах
 * агшин биш. `timestamptz` болговол UB (UTC+8) дээр өглөөний 8 цагаас
 * өмнө бүх ажил өмнөх өдөр рүү шилжинэ. Цаг нь (`at_time`) заавал биш,
 * зөвхөн харуулах зориулалттай.
 */
export class Tasks1788170000000 implements MigrationInterface {
  name = 'Tasks1788170000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "tasks" (
        "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
        "title"       varchar(200) NOT NULL,
        "notes"       varchar(2000),
        -- once | daily | weekly | monthly
        "kind"        varchar(10) NOT NULL DEFAULT 'once',
        /*
         * Бүх давталтын ТУЛГУУР огноо:
         *   once    — яг тэр өдөр
         *   daily   — энэ өдрөөс эхэлнэ
         *   weekly  — энэ огнооны ГАРАГААР давтана
         *   monthly — энэ огнооны ӨДРИЙН ДУГААРААР давтана
         * Гараг/өдрийг тусдаа багана болгоогүй: хоёр эх сурвалж байвал
         * тэдгээр зөрөх боломж үүснэ.
         */
        "starts_on"   date NOT NULL,
        /** Заавал биш — «08:30-д» гэх мэт. Зөвхөн харуулах, сануулахад. */
        "at_time"     time,
        /* Заавал биш төгсгөл. once-д хэрэггүй. */
        "ends_on"     date,
        "assignee_id" uuid,
        /** Унтраасан ажил календарьт гарахгүй ч ТҮҮХ нь үлдэнэ. */
        "active"      boolean NOT NULL DEFAULT true,
        "created_by"  uuid,
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tasks_assignee" FOREIGN KEY ("assignee_id")
          REFERENCES "staff_users"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_tasks_creator" FOREIGN KEY ("created_by")
          REFERENCES "staff_users"("id") ON DELETE SET NULL
      )
    `);

    // Календарь нь «идэвхтэй, энэ мужид эхэлсэн» ажлуудыг татна.
    await q.query(
      `CREATE INDEX "ix_tasks_active" ON "tasks" ("active", "starts_on")`,
    );
    // Нүүр хуудсан дээрх «миний ажил».
    await q.query(
      `CREATE INDEX "ix_tasks_assignee" ON "tasks" ("assignee_id")
         WHERE "assignee_id" IS NOT NULL`,
    );

    await q.query(`
      CREATE TABLE "task_completions" (
        "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
        "task_id"       uuid NOT NULL,
        /** АЛЬ ӨДРИЙН тохиолдлыг гүйцэтгэсэн бэ. */
        "occurrence_on" date NOT NULL,
        "done_by"       uuid,
        "done_at"       timestamptz NOT NULL DEFAULT now(),
        "note"          varchar(500),
        CONSTRAINT "pk_task_completions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_completions_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_completions_staff" FOREIGN KEY ("done_by")
          REFERENCES "staff_users"("id") ON DELETE SET NULL
      )
    `);

    /*
     * ⚠ UNIQUE — «гүйцэтгэсэн» гэдгийг ИДЕМПОТЕНТ болгоно.
     *
     * Хоёр ажилтан нэг ажлыг зэрэг тэмдэглэхэд хоёр мөр үүсвэл
     * «гүйцэтгэсэн үү» гэсэн асуулт хоёр хариутай болно. Давхардлыг
     * сан дээр хаах нь кодын шалгалтаас найдвартай.
     */
    await q.query(`
      CREATE UNIQUE INDEX "uq_task_completion"
        ON "task_completions" ("task_id", "occurrence_on")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "task_completions"`);
    await q.query(`DROP TABLE "tasks"`);
  }
}
