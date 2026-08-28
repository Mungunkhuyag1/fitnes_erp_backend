import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Утасны дугаарыг СОНГОЛТТОЙ болгов.
 *
 * ШАЛТГААН: Hikvision терминал дээр утасны дугаар ХАДГАЛАГДДАГГҮЙ —
 * талбар нь ч байхгүй. Ажиллаж буй фитнесийн 339 гишүүнийг импортлоход
 * бүгд утасгүй ирнэ. Утсыг заавал болговол импорт огт хийгдэхгүй.
 *
 * ⚠ Утасгүй гишүүн нь Loopy-тэй ХОЛБОГДОХГҮЙ (утас нь тэнд гол
 * түлхүүр). Тиймээс:
 *   · `loopy.allowPhone` нь утасгүй гишүүнийг чимээгүй алгасна
 *   · Dashboard дээр «утас оруулах шаардлагатай» гэж ТОМООР харуулна
 *
 * Гараар бүртгэхэд утас ЗААВАЛ хэвээр — DTO өөрчлөгдөөгүй. Зөвхөн
 * импорт л утасгүй мөр үүсгэнэ.
 */
export class MemberPhoneOptional1787990000000 implements MigrationInterface {
  name = 'MemberPhoneOptional1787990000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "members" ALTER COLUMN "phone" DROP NOT NULL`);
    // Хуучин шалгалт нь NULL-ыг зөвшөөрдөггүй тул дахин тодорхойлно.
    await q.query(`ALTER TABLE "members" DROP CONSTRAINT "CK_members_phone"`);
    await q.query(`
      ALTER TABLE "members" ADD CONSTRAINT "CK_members_phone"
        CHECK ("phone" IS NULL OR "phone" ~ '^[5-9][0-9]{7}$')
    `);
    // `uq_members_phone` нь хэвээр: PostgreSQL-д NULL-ууд хоорондоо
    // давхардсан гэж тооцогддоггүй тул олон утасгүй мөр зэрэг байж болно.
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM "members" WHERE "phone" IS NULL`);
    await q.query(`ALTER TABLE "members" DROP CONSTRAINT "CK_members_phone"`);
    await q.query(`
      ALTER TABLE "members" ADD CONSTRAINT "CK_members_phone"
        CHECK ("phone" ~ '^[5-9][0-9]{7}$')
    `);
    await q.query(`ALTER TABLE "members" ALTER COLUMN "phone" SET NOT NULL`);
  }
}
