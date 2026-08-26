import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Гуравдагч талын access token — ПРОЦЕССООС ГАДНА хадгална.
 *
 * Шалтгаан: Bonum-ын `auth/create` нь хязгаартай (throttle). Токеныг зөвхөн
 * санах ойд барихад Railway дээр deploy/restart бүрд кэш цоо хоосон болж
 * дахин auth хийнэ — өдөрт хэдэн арван нэмэлт дуудлага. Хүсэлтүүд зэрэг
 * ирвэл (олон гишүүн зэрэг төлбөр хийх) БҮГД зэрэг auth хийж «сүргийн
 * дайралт» үүсгэнэ.
 *
 * Redis биш Postgres сонгосон нь: токен ~30 минутад НЭГ л удаа шинэчлэгддэг
 * тул хурдны шаардлага байхгүй, харин `SELECT … FOR UPDATE` нь Redis-ийн
 * энгийн GET/SET-ээс давуу — зэрэг ирсэн хүсэлтүүдийг DB өөрөө дараална.
 * Мөн outbox-ыг BullMQ биш Postgres дээр барьсантай нэг шугам.
 */
@Entity('integration_tokens')
export class IntegrationToken {
  /** Үйлчилгээний нэр — одоогоор зөвхөн `bonum`. */
  @PrimaryColumn({ type: 'varchar', length: 40 })
  provider: string;

  @Column({ name: 'access_token', type: 'text' })
  accessToken: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /**
   * Bonum-ын refresh token — access-ээс хамаагүй урт настай (≈24 цаг).
   *
   * Үүнийг хадгалснаар access дуусахад `auth/create` биш `auth/refresh`
   * дуудна. Bonum нь `auth/create`-ыг илүү чанга throttle хийдэг.
   */
  @Column({ name: 'refresh_token', type: 'text', nullable: true })
  refreshToken: string | null;

  /**
   * Амжилтгүй болсны дараах хүлээлт. Энэ хугацаа дуустал ДАХИН auth
   * ХИЙХГҮЙ — унасан үйлчилгээ рүү дахин дахин цохилтгүй.
   */
  @Column({ name: 'retry_after', type: 'timestamptz', nullable: true })
  retryAfter: Date | null;

  /** Сүүлийн алдаа — тохиргооны дэлгэцэд шалтгааныг харуулна. */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
