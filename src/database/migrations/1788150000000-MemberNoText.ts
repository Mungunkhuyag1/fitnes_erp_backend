import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Гишүүний дугаарыг ТЕКСТ болгох.
 *
 * ★ ЯАГААД
 *
 * `member_no` нь Hikvision-ы `employeeNo` мөн. Терминал дээр тэр нь
 * ТЕКСТ талбар — `admin`, `Adiya` гэх мэт утга гараар бичигдэж болно,
 * ISAPI нь ч `String(employeeNo)` гэж дамжуулдаг. Тоо байх шаардлагыг
 * WinFit өөрөө зохиомлоор тулгаж байв.
 *
 * Үр дагавар нь бодит байсан: терминал дээрх текст дугаартай мөр
 * импортыг бүхэлд нь унагааж (`22P02`), тэр хүний ирц `member_id`
 * NULL-тай үүрд өнчин үлддэг байлаа.
 *
 * ⚠ ХОЁР БАГАНА ЗЭРЭГ. `access_events.employee_no` нь `members.member_no`
 * -той тулгалддаг (`e.employee_no = m.member_no`). Нэгийг нь үлдээвэл
 * харьцуулалт төрлийн алдаа өгнө.
 *
 * ⚠ ДАРААЛАЛ ХЭВЭЭР. `member_no_seq` нь WinFit дээр шинээр үүсгэсэн
 * гишүүнд дугаар олгосоор байна — зүгээр л текст болгож хадгална.
 * Тиймээс эрэмбэ, «хамгийн их дугаар» гэх мэт газруудад `::int`
 * хөрвүүлэлт ЗААВАЛ хэрэгтэй: текстээр `'999' > '1006'`.
 *
 * ⚠ `uq_members_no` индексийг гараар дахин үүсгэх шаардлагагүй —
 * `ALTER COLUMN ... TYPE` нь хүснэгтийг дахин бичихдээ индексүүдээ
 * өөрөө дахин барьдаг.
 */
export class MemberNoText1788150000000 implements MigrationInterface {
  name = 'MemberNoText1788150000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "members"
        ALTER COLUMN "member_no" TYPE character varying(32)
        USING "member_no"::text
    `);
    await q.query(`
      ALTER TABLE "access_events"
        ALTER COLUMN "employee_no" TYPE character varying(32)
        USING "employee_no"::text
    `);
  }

  /**
   * ⚠ БУЦААХ НЬ АЛДАГДАЛТАЙ.
   *
   * Текст дугаартай гишүүн үүссэн бол `members` буцаж хөрвөхгүй —
   * ALTER нь алдаа өгч зогсоно. Энэ нь ЗОРИУД: чимээгүй устгахаас
   * буцахгүй байх нь дээр. Ирцийн зүгээс текст дугаарыг NULL болгоно
   * (тэр мөр нь ямар ч гишүүнтэй тулгалдахаа больсон гэсэн үг).
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "access_events"
        ALTER COLUMN "employee_no" TYPE integer
        USING (CASE WHEN "employee_no" ~ '^[0-9]+$'
                    THEN "employee_no"::integer END)
    `);
    await q.query(`
      ALTER TABLE "members"
        ALTER COLUMN "member_no" TYPE integer
        USING "member_no"::integer
    `);
  }
}
