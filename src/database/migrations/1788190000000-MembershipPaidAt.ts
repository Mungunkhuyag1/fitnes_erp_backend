import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Худалдан авалт ТӨЛӨГДСӨН эсэх.
 *
 * ★ ЯМАР АСУУДЛЫГ ШИЙДЭЖ БАЙНА ВЭ
 *
 * Ресепшн дээр гишүүн багцаа сонгоод «мөнгөө маргааш авчирна» гэх нь
 * олонтаа. Одоогийн систем үүнийг илэрхийлэх аргагүй: `memberships`
 * мөр үүсмэгц дүн нь ОРЛОГО гэж тооцогддог. Ажилтны сонголт хоёулаа
 * буруу:
 *
 *   • Бүртгэвэл  → мөнгө ирээгүй мөртлөө орлогод орно, хэнээс авахаа
 *                  мартана
 *   • Бүртгэхгүй → гишүүн зааланд орж чадахгүй
 *
 * `paid_at` нь эрхийг ТӨЛБӨРӨӨС салгана: эрх нь шууд нээгдэнэ, мөнгө
 * нь хожим бүртгэгдэнэ.
 *
 * ★ ЯАГААД `boolean` БИШ ВЭ
 *
 * «Хэзээ төлсөн» нь «төлсөн үү»-гээс илүү мэдээлэл өгнө: авлага хэдэн
 * хоног хэвтснийг тооцох, өдрийн кассын тайланг ТӨЛСӨН огноогоор нь
 * гаргах боломжтой. Хоосон утга нь «төлөгдөөгүй» гэсэн үг.
 *
 * ⚠ ХУУЧИН МӨРҮҮД БҮГД ТӨЛӨГДСӨН. Энэ талбар гарахаас өмнө «дараа
 * төлөх» гэсэн ойлголт байгаагүй тул бүх бичлэг мөнгө хүлээж авсны
 * дараа үүссэн. `created_at`-аар нөхнө — эс бөгөөс өнөөдөр бүх түүх
 * авлага болж харагдана.
 *
 * ⚠ `freeze` мөрүүд ч нөхөгдөнө. Тэдгээрийн дүн нь ҮРГЭЛЖ 0 тул
 * авлагад нөлөөлөхгүй, гэхдээ «төлөгдөөгүй» гэж харагдвал жагсаалтыг
 * дэмий бөглөнө.
 */
export class MembershipPaidAt1788190000000 implements MigrationInterface {
  name = 'MembershipPaidAt1788190000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "memberships" ADD "paid_at" TIMESTAMP WITH TIME ZONE`);

    // Хуучин бүх бичлэг төлөгдсөн — үүсэх агшиндаа мөнгө нь ирсэн.
    await q.query(`UPDATE "memberships" SET "paid_at" = "created_at"`);

    /*
     * Авлагын жагсаалт нь «төлөгдөөгүй» мөрүүдийг л хардаг. Хэсэгчилсэн
     * индекс нь зөвхөн тэдгээрийг агуулах тул жижиг бөгөөд хурдан —
     * төлөгдсөн олон мянган мөр индексийг дүүргэхгүй.
     */
    await q.query(
      `CREATE INDEX "ix_memberships_unpaid" ON "memberships" ("created_at")
         WHERE "paid_at" IS NULL AND "reversed_at" IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "ix_memberships_unpaid"`);
    await q.query(`ALTER TABLE "memberships" DROP COLUMN "paid_at"`);
  }
}
