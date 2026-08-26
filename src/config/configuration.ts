/**
 * Бүтэцлэгдсэн, typed config. `ConfigService.getOrThrow('database.url')` гэх мэт
 * dot-path-аар хандана. `env.validation.ts` нь boot үед түүхий env-ийг шалгасан
 * тул энд утга баталгаатай гэж үзнэ.
 */
const toList = (v?: string): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const toInt = (v: string | undefined, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
};

export const configuration = () => ({
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: toInt(process.env.PORT, 3100),
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3100',
  dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:3101',
  corsOrigins: toList(process.env.CORS_ORIGINS),
  /** Бүх огнооны тооцоолол (хугацаа дуусах, ирц, сануулга) энэ бүсээр. */
  timezone: process.env.TZ ?? 'Asia/Ulaanbaatar',

  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL !== 'false',
    logging: process.env.DB_LOGGING === 'true',
  },

  redis: {
    url: process.env.REDIS_URL,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },

  /**
   * Гадаад хамаарал бүр `stub` эсвэл жинхэнэ горимтой. Хөгжүүлэлтийн үед
   * гурвуулаа `stub` — төхөөрөмж, Loopy, банкгүйгээр бүрэн ажиллана.
   * Дэлгэрэнгүй: docs/05-backend-api.md §6.
   */
  gateways: {
    device: process.env.DEVICE_GATEWAY ?? 'stub', // stub | agent
    loopy: process.env.LOOPY_MODE ?? 'stub', // stub | live
    bonum: process.env.BONUM_MODE ?? 'stub', // stub | live
  },

  /** Stub-ийн зан төлөв — эвдрэлийг дуурайлгаж retry/алдааны урсгалыг турших. */
  stub: {
    failureRate: Number(process.env.STUB_FAILURE_RATE ?? '0'),
    latencyMinMs: toInt(process.env.STUB_LATENCY_MIN_MS, 100),
    latencyMaxMs: toInt(process.env.STUB_LATENCY_MAX_MS, 400),
    deviceOffline: process.env.STUB_DEVICE_OFFLINE === 'true',
    faceAutoEnrollSec: toInt(process.env.STUB_FACE_AUTO_ENROLL, 30),
  },

  outbox: {
    /** Backoff (секунд, таслалаар). Оролдлогын тоо = элементийн тоо. */
    backoffSec: process.env.OUTBOX_BACKOFF_SEC ?? '60,300,1800,7200,21600',
    batchSize: toInt(process.env.OUTBOX_BATCH_SIZE, 10),
    intervalMs: toInt(process.env.OUTBOX_INTERVAL_MS, 15_000),
  },

  loopy: {
    apiUrl: process.env.LOOPY_API_URL,
    apiKey: process.env.LOOPY_API_KEY,
    programId: process.env.LOOPY_PROGRAM_ID,
    /** Заавал биш — Loopy талын салбарыг ялгах цорын ганц утга. */
    branchId: process.env.WINFIT_LOOPY_BRANCH_ID || null,
    rateLimitPerMin: toInt(process.env.LOOPY_RATE_LIMIT_PER_MIN, 60),
    webhookSecret: process.env.LOOPY_WEBHOOK_SECRET,
  },

  bonum: {
    apiUrl: process.env.BONUM_API_URL ?? 'https://testapi.bonum.mn',
    appSecret: process.env.BONUM_APP_SECRET,
    terminalId: process.env.BONUM_TERMINAL_ID,
    checksumKey: process.env.BONUM_CHECKSUM_KEY,
    webhookSecret: process.env.BONUM_WEBHOOK_SECRET,
    returnUrl: process.env.BONUM_RETURN_URL,
    /** Нэхэмжлэхийн хүчинтэй хугацаа (секунд). */
    invoiceTtlSec: toInt(process.env.INVOICE_TTL_SEC, 3600),
  },

  hikvision: {
    /** `DEVICE_GATEWAY=direct` үед терминалтай шууд холбогдох хаяг. */
    host: process.env.HIK_HOST,
    port: toInt(process.env.HIK_PORT, 80),
    user: process.env.HIK_USER ?? 'admin',
    password: process.env.HIK_PASSWORD,
    https: process.env.HIK_HTTPS === 'true',
    /** 24/7 цагийн загварын дугаар. Цагийн хязгаар байхгүй — docs/01 §6.9. */
    planTemplateNo: process.env.HIK_PLAN_TEMPLATE_NO ?? '1',
    doorNo: toInt(process.env.HIK_DOOR_NO, 1),
  },

  reminder: {
    milestones: toList(process.env.REMINDER_MILESTONES).length
      ? toList(process.env.REMINDER_MILESTONES)
      : ['T-7', 'T-3', 'T-1', 'T0'],
    hour: toInt(process.env.REMINDER_HOUR, 9),
  },
});

export type AppConfig = ReturnType<typeof configuration>;
