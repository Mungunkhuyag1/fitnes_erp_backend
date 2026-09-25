/**
 * ХУВААРЬТ АЖЛУУДЫН ЦАГ — БҮГД ЭНД.
 *
 * ★ ЯАГААД НЭГ ФАЙЛД ВЭ
 *
 * Өмнө нь cron-ууд 9 өөр service дотор тарсан байв. Үр дүнд нь
 * «шөнө ямар ажил ажилладаг вэ?» гэсэн хамгийн энгийн асуултад
 * хариулахын тулд бүх модулийг грепдэх хэрэгтэй болж, ажлууд хоорондоо
 * зөрчилдөж байгаа эсэхийг хэн ч харж чадахгүй байлаа.
 *
 * ★ ЗААЛНЫ КОМПЬЮТЕР ШӨНӨ УНТАРДАГ
 *
 * Терминал нь фитнесийн дотоод сүлжээнд байдаг ба гадна талаас зөвхөн
 * заалны Windows PC дээрх `cloudflared` туннелээр хүрнэ. Заал хаагдахад
 * тэр PC унтардаг тул ~23:00 – ~07:00 хооронд:
 *
 *   • терминал руу хандах БҮХ хүсэлт 530-аар унана
 *   • `outbox` дахь `hik.*` мөрүүд 4 удаа дахин оролдоод (60с, 300с,
 *     1800с, 7200с) 5 дахь удаадаа ЭЦСИЙН байдлаар `failed` болно —
 *     00:30-д үүссэн бичилт 03:06 гэхэд үүрд унтарна
 *
 * Тиймээс ТУННЕЛЭЭС ХАМААРАХ ажил шөнө ажиллах нь утгагүй. Бүгдийг
 * ӨГЛӨӨ 07:00-аас хойш зөөв.
 *
 * ★ ДАРААЛАЛ УТГАТАЙ
 *
 *   00:05  эрх дуусгах     — санд л бичнэ, туннель хэрэггүй
 *   00:30  чөлөө дуусгах   — санд л бичнэ (бичилтийг 07:00 нөхнө)
 *   04:00  Loopy тулгалт   — Loopy бол үүлэн API, туннель хэрэггүй
 *   04:30  outbox цэвэрлэх — санд л бичнэ
 *   04:40  токен цэвэрлэх  — санд л бичнэ
 *   07:00  терминал тулгалт ◄ ТУННЕЛЬ — PC асч, туннель дээшилсэн байна
 *   07:30  терминал нөхөлт ◄ ТУННЕЛЬ — тулгалтын үлдэгдлийг засна
 *   09:00  сануулга илгээх  — дээрх бүгдийн ДАРАА, өгөгдөл зөв байна
 *   23:00  өдрийн тайлан    — мэйл, туннель хэрэггүй
 *
 * ⚠ Заал хэдэн цагт ондоо цагт нээдэг бол Railway → Variables дээр
 * `CRON_DEVICE_AUDIT` / `CRON_DEVICE_RECONCILE`-ыг сольж болно —
 * дахин deploy шаардахгүй.
 */
export const CRON = {
  /** Хугацаа дууссан гишүүдийн төлвийг санд нийцүүлнэ. Туннель ХЭРЭГГҮЙ. */
  EXPIRE_MEMBERSHIPS: process.env.CRON_EXPIRE_MEMBERSHIPS ?? '5 0 * * *',

  /**
   * Хугацаа дууссан чөлөөг хаана. Туннель ХЭРЭГГҮЙ — гэвч нэмэгдсэн
   * хоног нь `hik.setValidity` бичилт үүсгэнэ, тэр нь шөнө унана.
   * 07:00-ийн тулгалт зөрүүг олж дахин бичнэ.
   */
  FREEZE_EXPIRE: process.env.CRON_FREEZE_EXPIRE ?? '30 0 * * *',

  /** Loopy-гийн картуудыг тулгана. Туннель ХЭРЭГГҮЙ (үүлэн API). */
  LOOPY_RECONCILE: process.env.CRON_LOOPY_RECONCILE ?? '0 4 * * *',

  /** Хуучин outbox мөрүүдийг устгана. Туннель ХЭРЭГГҮЙ. */
  OUTBOX_PRUNE: process.env.CRON_OUTBOX_PRUNE ?? '30 4 * * *',

  /** Хүчингүй refresh токенуудыг устгана. Туннель ХЭРЭГГҮЙ. */
  TOKEN_PRUNE: process.env.CRON_TOKEN_PRUNE ?? '40 4 * * *',

  /** ◄ ТУННЕЛЬ. Терминалын 337 хэрэглэгчийг WinFit-тэй тулгана. */
  DEVICE_AUDIT: process.env.CRON_DEVICE_AUDIT ?? '0 7 * * *',

  /** ◄ ТУННЕЛЬ. `hik_sync_error`-тэй гишүүдийг дахин дараалалд оруулна. */
  DEVICE_RECONCILE: process.env.CRON_DEVICE_RECONCILE ?? '30 7 * * *',

  /** Гишүүдэд хугацаа дуусах сануулга. Туннель ХЭРЭГГҮЙ. */
  SEND_REMINDERS: process.env.CRON_SEND_REMINDERS ?? '0 9 * * *',

  /** Өдрийн тайлангийн мэйл. Туннель ХЭРЭГГҮЙ. */
  DAILY_DIGEST: process.env.CRON_DAILY_DIGEST ?? '0 23 * * *',
} as const;

/** Хуваарьт ажлуудын цагийн бүс — cron нь локал цагаар ажиллана. */
export const SCHEDULE_TZ = process.env.TZ ?? 'Asia/Ulaanbaatar';

/**
 * ЗААЛ ХААЛТТАЙ ЦАГ — терминалд хүрэхгүй гэдгийг УРЬДЧИЛАН мэдэх муж.
 *
 * `DEVICE_QUIET_FROM=0` тавибал завсарлага бүрэн унтарна (24 цагийн
 * турш мэйл явна).
 */
export const QUIET_FROM_HOUR = Number(process.env.DEVICE_QUIET_FROM ?? 22);
export const QUIET_TO_HOUR = Number(process.env.DEVICE_QUIET_TO ?? 7);

/** Тухайн цагийн бүсийн ЦАГ (0–23). */
export function hourIn(tz: string, now: Date = new Date()): number {
  // ⚠ `hour12: false` нь хэрэгжүүлэлтээс хамаарч шөнө дунд «24» буцаадаг.
  // `hourCycle: 'h23'` нь 0–23 гэдгийг БАТАЛНА.
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
}

/**
 * Одоо заал хаалттай үе юу.
 *
 * ⚠ Муж нь ШӨНӨ ДУНДЫГ давна (22 → 7) тул `from <= h && h < to` гэж
 * бичиж БОЛОХГҮЙ — тэр нь хэзээ ч үнэн болохгүй.
 */
export function inQuietHours(
  tz: string = SCHEDULE_TZ,
  now: Date = new Date(),
): boolean {
  if (QUIET_FROM_HOUR === QUIET_TO_HOUR) return false;
  const h = hourIn(tz, now);
  return QUIET_FROM_HOUR < QUIET_TO_HOUR
    ? h >= QUIET_FROM_HOUR && h < QUIET_TO_HOUR
    : h >= QUIET_FROM_HOUR || h < QUIET_TO_HOUR;
}
