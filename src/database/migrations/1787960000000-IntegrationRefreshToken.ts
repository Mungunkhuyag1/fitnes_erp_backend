import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refresh token хадгалах багана.
 *
 * Bonum-ын `auth/create` нь хязгаартай. Гэвч тэр нь `accessToken`-ийн хамт
 * `refreshToken` буцаадаг бөгөөд `auth/refresh` эндпойнтоор access-ээ
 * шинэчилж болно. Refresh нь ≈24 цаг настай тул өдөрт НЭГ л удаа
 * `auth/create` дуудахад хангалттай.
 */
export class IntegrationRefreshToken1787960000000 implements MigrationInterface {
  name = 'IntegrationRefreshToken1787960000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "integration_tokens" ADD COLUMN "refresh_token" text`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "integration_tokens" DROP COLUMN "refresh_token"`,
    );
  }
}
