import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Багц УСТГАХ.
 *
 * Ашиглагдаж байгаагүй багц бүрмөсөн устгагдана. Зарагдсан (эсвэл
 * нэхэмжлэхтэй) багц `deleted_at`-тай болж жагсаалт, сайтаас алга
 * болно — тайлан (`LEFT JOIN packages`) ба төлөгдөөгүй нэхэмжлэх
 * түүнийг ID-аар нь олсоор байх ёстой.
 */
export class PackageDeletedAt1788260000000 implements MigrationInterface {
  name = 'PackageDeletedAt1788260000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "packages" DROP COLUMN IF EXISTS "deleted_at"`);
  }
}
