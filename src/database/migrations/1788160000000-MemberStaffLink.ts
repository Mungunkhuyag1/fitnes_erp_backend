import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Гишүүнийг АЖИЛТНЫ данстай холбох.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * Терминал дээр ажилтан, дасгалжуулагч, админ нар өөрсдийн царайгаа
 * бүртгүүлсэн байдаг — тэд өдөр бүр, заримдаа өдөрт хэд хэдэн удаа
 * уншуулна. Терминал тэднийг гишүүдээс ЯЛГАДАГГҮЙ: бүлэг, төрлийн
 * талбар байхгүй. Тиймээс тайлан дээр «хамгийн идэвхтэй гишүүн» гэж
 * ажилтан гарч ирээд бодит дүр зургийг гуйвуулна.
 *
 * Хэн ажилтан бэ гэдгийг ТААМАГЛАЖ болохгүй (нэрээр нь таних, «admin»
 * гэсэн үг хайх гэх мэт нь эмзэг). Харин WinFit дээр аль хэдийн
 * ажилтны данс байдаг — түүнтэй нь ГАРААР холбоно. Холбогдсон гишүүн
 * тайлангийн тооцооллоос хасагдана.
 *
 * ⚠ УСТГАХГҮЙ. Холболт нь зөвхөн ТЭМДЭГ: гишүүний бүртгэл, ирц, төлбөр
 * бүгд хэвээр үлдэнэ. Ажилтан гишүүнчлэл худалдаж авч ч болно.
 *
 * ⚠ UNIQUE. Нэг ажилтны данс хоёр терминалын хүнтэй холбогдвол аль нь
 * үнэн болох нь тодорхойгүй болно. Хоосон утга олон байж болно тул
 * хэсэгчилсэн индекс.
 *
 * `ON DELETE SET NULL` — ажилтныг системээс хасахад гишүүн нь устах
 * ёсгүй, зүгээр л холболтоо алдана.
 */
export class MemberStaffLink1788160000000 implements MigrationInterface {
  name = 'MemberStaffLink1788160000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "members"
        ADD COLUMN "staff_user_id" uuid,
        ADD CONSTRAINT "fk_members_staff"
          FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id")
          ON DELETE SET NULL
    `);
    await q.query(`
      CREATE UNIQUE INDEX "uq_members_staff" ON "members" ("staff_user_id")
        WHERE "staff_user_id" IS NOT NULL
    `);
    // Тайлан бүр «ажилтан биш» гэж шүүдэг тул энэ нь халуун зам.
    await q.query(`
      CREATE INDEX "ix_members_not_staff" ON "members" ("id")
        WHERE "staff_user_id" IS NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "ix_members_not_staff"`);
    await q.query(`DROP INDEX "uq_members_staff"`);
    await q.query(`
      ALTER TABLE "members"
        DROP CONSTRAINT "fk_members_staff",
        DROP COLUMN "staff_user_id"
    `);
  }
}
