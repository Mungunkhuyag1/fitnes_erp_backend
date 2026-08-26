import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Гуравдагч талын токены сан.
 *
 * Bonum-ын access token нь процессын санах ойд байсан тул restart/redeploy
 * бүрд алга болж дахин auth хийдэг байв. Bonum auth-ыг throttle хийдэг тул
 * энэ нь 503 үүсгэх эрсдэлтэй. Мөр цөөн (провайдер тутам НЭГ), бичилт
 * ховор — тусдаа Redis шаардахгүй.
 */
export class IntegrationToken1787950000000 implements MigrationInterface {
  name = 'IntegrationToken1787950000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "integration_tokens" (
        "provider"     varchar(40)  NOT NULL,
        "access_token" text         NOT NULL,
        "expires_at"   timestamptz  NOT NULL,
        "retry_after"  timestamptz,
        "last_error"   text,
        "updated_at"   timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_integration_tokens" PRIMARY KEY ("provider")
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "integration_tokens"`);
  }
}
