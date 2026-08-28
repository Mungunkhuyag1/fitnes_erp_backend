import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Багцын зорилтот бүлэг ба нөхцөлүүд.
 *
 * Заалны үнийн самбар нь ижил хугацааг өөр өөр үнээр зардаг (30 хоног:
 * энгийн 250,000₮, оюутан 160,000₮, ахмад 150,000₮). Мөр тус бүрийг
 * хэвээр үлдээж, ЯЛГААГ нь тайлбарлах талбарууд нэмнэ — ингэснээр
 * ресепшний самбартай 1:1 таарна.
 */
export class PackageAudience1788010000000 implements MigrationInterface {
  name = 'PackageAudience1788010000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "packages" ADD "audience" character varying(20) NOT NULL DEFAULT 'standard'`,
    );
    // Хөнгөлөлттэй багц — ресепшн дээр баримт шалгаж эрхийг нээнэ.
    await q.query(
      `ALTER TABLE "packages" ADD "requires_proof" boolean NOT NULL DEFAULT false`,
    );
    // «Анх удаа 188,000₮» — өмнө нь гишүүнчлэл аваагүй хүнд л.
    await q.query(
      `ALTER TABLE "packages" ADD "first_time_only" boolean NOT NULL DEFAULT false`,
    );
    // Хосын багц = 2. Бусад бүгд 1.
    await q.query(`ALTER TABLE "packages" ADD "seats" integer NOT NULL DEFAULT 1`);
    // Зарим багц зөвхөн ресепшнээр зарагдана (хосын багц, хөнгөлөлттэй).
    await q.query(
      `ALTER TABLE "packages" ADD "online" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "packages" DROP COLUMN "online"`);
    await q.query(`ALTER TABLE "packages" DROP COLUMN "seats"`);
    await q.query(`ALTER TABLE "packages" DROP COLUMN "first_time_only"`);
    await q.query(`ALTER TABLE "packages" DROP COLUMN "requires_proof"`);
    await q.query(`ALTER TABLE "packages" DROP COLUMN "audience"`);
  }
}
