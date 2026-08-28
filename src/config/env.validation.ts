import * as Joi from 'joi';

/**
 * Boot үед түүхий env-ийг шалгана. Хэрэв заавал шаардлагатай утга дутуу бол
 * апп асахгүй — production-д хагас тохируулгатай ажиллахаас сэргийлнэ.
 *
 * Үе шаттай (phase-gated) түлхүүрүүд — Loopy, Bonum — хоосон зөвшөөрөгдөнө.
 * Тэдгээр нь `*_MODE=stub` үед огт хэрэггүй; `live` болгоход шаардагдана
 * (тухайн сервис өөрөө boot дээр шалгана).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3100),
  TZ: Joi.string().default('Asia/Ulaanbaatar'),

  API_BASE_URL: Joi.string().allow('').default('http://localhost:3100'),
  DASHBOARD_URL: Joi.string().allow('').default('http://localhost:3101'),
  CORS_ORIGINS: Joi.string().allow('').default(''),

  // ── Заавал ──
  DATABASE_URL: Joi.string().required(),
  DATABASE_SSL: Joi.string().valid('true', 'false').default('true'),
  DB_LOGGING: Joi.string().valid('true', 'false').default('false'),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('30d'),

  REDIS_URL: Joi.string().allow('').default(''),

  // ── Админ бүртгэл (seed:admin) ──
  // Апп ажиллахад хэрэггүй — зөвхөн seed script уншина. Гэхдээ энд
  // бичсэнээр буруу утга (жишээ нь 4 тэмдэгт нууц үг) эрт илэрнэ.
  ADMIN_EMAIL: Joi.string().email().allow('').default(''),
  ADMIN_PASSWORD: Joi.string().allow('').min(8).default(''),
  ADMIN_NAME: Joi.string().allow('').default(''),

  // ── Gateway горим ──
  DEVICE_GATEWAY: Joi.string()
    .valid('stub', 'direct', 'agent')
    .default('stub'),
  LOOPY_MODE: Joi.string().valid('stub', 'live').default('stub'),
  BONUM_MODE: Joi.string().valid('stub', 'live').default('stub'),

  // ── Stub зан төлөв ──
  STUB_FAILURE_RATE: Joi.number().min(0).max(1).default(0),
  STUB_LATENCY_MIN_MS: Joi.number().min(0).default(100),
  STUB_LATENCY_MAX_MS: Joi.number().min(0).default(400),
  STUB_DEVICE_OFFLINE: Joi.string().valid('true', 'false').default('false'),
  STUB_FACE_AUTO_ENROLL: Joi.number().min(0).default(30),

  // ── Outbox ──
  OUTBOX_BACKOFF_SEC: Joi.string().allow('').default('60,300,1800,7200,21600'),
  OUTBOX_BATCH_SIZE: Joi.number().min(1).max(100).default(10),
  // Давталтын давтамж (мс). Хөгжүүлэлтэд шуурхай, production-д DB-г бага
  // сэрээхээр өндөр тавьж болно — §10-р баримт үзнэ үү.
  OUTBOX_INTERVAL_MS: Joi.number().min(500).max(300_000).default(15_000),
  INVOICE_EXPIRE_INTERVAL_MS: Joi.number().min(5_000).max(300_000).default(30_000),

  // ── Loopy ──
  // `LOOPY_MODE=live` үед доорх утгууд ЗААВАЛ байх ёстой. Эс бөгөөс систем
  // хэвийн асаад, эхний карт үүсэх гэж оролдох үед л алдаа гарна — тэр үед
  // шалтгааныг олоход хэцүү. Асахдаа шууд унасан нь дээр.
  LOOPY_API_URL: Joi.string()
    .allow('')
    .default('')
    .when('LOOPY_MODE', { is: 'live', then: Joi.string().uri().invalid('').required() }),
  LOOPY_API_KEY: Joi.string()
    .allow('')
    .default('')
    .when('LOOPY_MODE', { is: 'live', then: Joi.string().min(20).invalid('').required() }),
  LOOPY_PROGRAM_ID: Joi.string()
    .allow('')
    .default('')
    .when('LOOPY_MODE', { is: 'live', then: Joi.string().uuid().invalid('').required() }),
  // Салбар нь Loopy талд заавал биш — WinFit-д салбар гэсэн ойлголт байхгүй.
  WINFIT_LOOPY_BRANCH_ID: Joi.string().allow('').default(''),
  LOOPY_RATE_LIMIT_PER_MIN: Joi.number().default(60),
  // Webhook нууц үг байхгүй бол `card.enrolled` дуудлагыг хэн ч хуурч
  // болно — live үед заавал.
  LOOPY_WEBHOOK_SECRET: Joi.string()
    .allow('')
    .default('')
    .when('LOOPY_MODE', { is: 'live', then: Joi.string().min(16).invalid('').required() }),

  // ── Bonum ──
  BONUM_API_URL: Joi.string().allow('').default('https://testapi.bonum.mn'),
  BONUM_APP_SECRET: Joi.string()
    .allow('')
    .default('')
    .when('BONUM_MODE', { is: 'live', then: Joi.string().invalid('').required() }),
  BONUM_TERMINAL_ID: Joi.string()
    .allow('')
    .default('')
    .when('BONUM_MODE', { is: 'live', then: Joi.string().invalid('').required() }),
  BONUM_CHECKSUM_KEY: Joi.string()
    .allow('')
    .default('')
    .when('BONUM_MODE', { is: 'live', then: Joi.string().invalid('').required() }),
  BONUM_WEBHOOK_SECRET: Joi.string()
    .allow('')
    .default('')
    .when('BONUM_MODE', { is: 'live', then: Joi.string().min(16).invalid('').required() }),
  BONUM_RETURN_URL: Joi.string().allow('').default(''),
  INVOICE_TTL_SEC: Joi.number().default(3600),

  // ── Hikvision (DEVICE_GATEWAY=direct үед) ──
  // `agent` горимд эдгээр хэрэггүй — агент нь фитнесийн дотоод сүлжээнд
  // сууж, хаяг/нууц үгийг ӨӨРТӨӨ хадгална.
  // Хаяг DB-д хадгалагдана (Терминал → Сүлжээний хаяг), эсвэл дэд сүлжээнээс
  // автоматаар олдоно. Иймд `direct` горимд ч ЗААВАЛ БИШ — DHCP-ээр IP
  // солигдоход .env засаад дахин deploy хийхээс аварна.
  HIK_HOST: Joi.string().allow('').default(''),
  DEVICE_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  DEVICE_EVENT_POLL_MS: Joi.number().min(30_000).max(3_600_000).default(300_000),
  DEVICE_EVENT_WINDOW_MIN: Joi.number().min(1).max(1440).default(15),
  HIK_PORT: Joi.number().default(80),
  HIK_USER: Joi.string().allow('').default('admin'),
  // Нууц үгийг дэлгэцээс тохируулж, DB-д НУУЦЛААД хадгална. `.env` нь
  // зөвхөн анхны суулгалтын түлхэц — иймд заавал биш.
  HIK_PASSWORD: Joi.string().allow('').default(''),
  HIK_HTTPS: Joi.string().valid('true', 'false').default('false'),

  // ── Hikvision ──
  // ── Мэдэгдлийн мэйл (Resend) ──
  MAIL_MODE: Joi.string().valid('stub', 'live').default('stub'),
  RESEND_API_KEY: Joi.string()
    .allow('')
    .default('')
    .when('MAIL_MODE', { is: 'live', then: Joi.string().invalid('').required() }),
  MAIL_FROM: Joi.string()
    .allow('')
    .default('')
    .when('MAIL_MODE', { is: 'live', then: Joi.string().invalid('').required() }),
  MAIL_LARGE_PAYMENT: Joi.number().min(0).default(1_000_000),

  OUTBOX_RETENTION_DAYS: Joi.number().min(1).max(365).default(14),

  HIK_PLAN_TEMPLATE_NO: Joi.string().default('1'),
  HIK_DOOR_NO: Joi.number().default(1),

  // ── Сануулга ──
  REMINDER_MILESTONES: Joi.string().allow('').default('T-7,T-3,T-1,T0'),
  REMINDER_HOUR: Joi.number().min(0).max(23).default(9),
});
