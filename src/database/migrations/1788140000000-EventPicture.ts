import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Уншуулах үеийн зургийн ЗАМ.
 *
 * ★ ЗАМ Л ХАДГАЛНА, ХАЯГ БИШ
 *
 * Терминал зургийн хаягийг өөрийн IP-тэйгээ буцаадаг
 * (`http://192.168.0.106/LOCALS/pic/...`). Тэр IP нь DHCP-ээр
 * солигдож, терминал солиход өөрчлөгдөж, ирээдүйд `hik.winfit.mn`
 * гэх мэт домэйн болж ч мэднэ. Бүтэн хаягийг хадгалбал маргааш
 * эзэнгүй болно — хостыг харуулах агшинд тохиргооноос угсарна.
 *
 * ★ ЗУРГИЙН БАЙТЫГ ХАДГАЛАХГҮЙ
 *
 * Өдөрт хэдэн зуун уншуулалт бүрд зураг хадгалбал сан хэдхэн сард
 * хэдэн арван ГБ болж, нөөцлөлт, шилжүүлэлт бүгд хүндэрнэ. Харуулах
 * үед терминалаас нь татна.
 *
 * ⚠ Сул тал: терминалын санах ой хязгаартай тул ХУУЧИН зураг
 * дарагдана. Тэр үед зам нь үлдэх ч татахад олдохгүй.
 */
export class EventPicture1788140000000 implements MigrationInterface {
  name = 'EventPicture1788140000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "access_events" ADD "picture_path" character varying(300)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "access_events" DROP COLUMN "picture_path"`);
  }
}
