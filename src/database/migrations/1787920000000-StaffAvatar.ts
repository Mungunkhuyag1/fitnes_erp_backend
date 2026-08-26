import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ажилтны зураг.
 *
 * Гадаад файл сан ашиглахгүй — зургийг `data:` URL хэлбэрээр САНД хадгална.
 * Шалтгаан: ажилтны тоо цөөн (10-20), зураг нь 128×128 болж жижигрүүлэгдэнэ
 * (~10КБ). Үүний тулд S3 зэрэг дэд бүтэц босгох нь хэт өртөгтэй.
 *
 * Хэрэв ирээдүйд олон зураг хадгалах шаардлага гарвал энэ баганыг URL
 * болгож солино — интерфейс өөрчлөгдөхгүй.
 */
export class StaffAvatar1787920000000 implements MigrationInterface {
  name = 'StaffAvatar1787920000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "staff_users" ADD "avatar" text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "staff_users" DROP COLUMN "avatar"`);
  }
}
