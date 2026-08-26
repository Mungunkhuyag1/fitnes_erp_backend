import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * Production-д санамсаргүй stub горимоор үлдэхээс сэргийлнэ.
 *
 * Stub горим нь жинхэнэ төхөөрөмж/банк/Loopy-гүйгээр ажилладаг тул хөгжүүлэлтэд
 * зайлшгүй. Гэхдээ production-д ийм байвал «төлбөр төлөгдсөн» мэт харагдаад
 * бодитоор юу ч болохгүй — чимээгүй, аюултай алдаа. Тиймээс энд шууд унана.
 */
function assertNoStubInProd(config: ConfigService): void {
  if (config.get<string>('env') !== 'production') return;
  const gateways = config.get<Record<string, string>>('gateways') ?? {};
  const stubbed = Object.entries(gateways)
    .filter(([, mode]) => mode === 'stub')
    .map(([name]) => name);
  if (stubbed.length) {
    throw new Error(
      `⛔ Production дээр stub gateway идэвхтэй байна: ${stubbed.join(', ')}. ` +
        `DEVICE_GATEWAY / LOOPY_MODE / BONUM_MODE-г жинхэнэ горимд тохируулна уу.`,
    );
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Webhook-ийн HMAC-ийг ТҮҮХИЙ бие дээр шалгана (Bonum `x-checksum-v2`,
    // Loopy signature) — JSON parse хийсний дараа дахин угсарвал таарахгүй.
    rawBody: true,
  });
  const config = app.get(ConfigService);

  assertNoStubInProd(config);

  app.setGlobalPrefix('api');

  // Railway/proxy-гийн ард бодит client IP (throttle IP-ээр ажилладаг).
  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // `enableImplicitConversion` ЗОРИУД унтраалттай: тэр нь query string дэх
      // 'false' -ийг Boolean('false') = TRUE болгодог тул boolean шүүлтүүр
      // эсрэгээрээ ажилладаг байв. Тоо/boolean бүрд DTO дээр `@Type` /
      // `@Transform`-ыг ил бичнэ.
    }),
  );

  const corsOrigins = config.get<string[]>('corsOrigins') ?? [];
  const isDev = config.get<string>('env') !== 'production';
  const localhostRe = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  app.enableCors({
    origin:
      corsOrigins.length === 0
        ? true
        : (
            origin: string | undefined,
            cb: (err: Error | null, allow?: boolean) => void,
          ) => {
            if (!origin) return cb(null, true); // curl / server-to-server
            if (corsOrigins.includes(origin)) return cb(null, true);
            if (isDev && localhostRe.test(origin)) return cb(null, true);
            return cb(new Error(`CORS: ${origin} зөвшөөрөгдөөгүй`), false);
          },
    credentials: true,
  });

  app.enableShutdownHooks();

  // ── OpenAPI ──
  const openApi = new DocumentBuilder()
    .setTitle('WinFit API')
    .setDescription(
      'WinFit — фитнесийн гишүүнчлэл, нэвтрэлт, төлбөрийн систем. ' +
        'Эрх: Bearer JWT. Гадаад хамаарал (төхөөрөмж, Loopy, Bonum) stub горимтой.',
    )
    .setVersion('0.1.0')
    .addServer(config.get<string>('apiBaseUrl') ?? 'http://localhost:3100')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApi), {
    jsonDocumentUrl: 'api/openapi.json',
  });

  const port = config.get<number>('port') ?? 3100;
  await app.listen(port);

  const gateways = config.get<Record<string, string>>('gateways') ?? {};
  Logger.log(`WinFit backend :${port} (${config.get('env')})`, 'Bootstrap');
  Logger.log(
    `Gateway: device=${gateways.device} loopy=${gateways.loopy} bonum=${gateways.bonum}`,
    'Bootstrap',
  );
  Logger.log(`Docs: /api/docs`, 'Bootstrap');
}

void bootstrap();
