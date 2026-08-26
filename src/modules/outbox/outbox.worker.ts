import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PermanentError } from './outbox.errors';
import { OutboxRegistry } from './outbox.registry';
import { OutboxService } from './outbox.service';
import { OutboxSignal } from './outbox.signal';

/**
 * Outbox-ийг тогтмол шалгаж боловсруулна.
 *
 * BullMQ/Redis-ийн оронд DB-д тулгуурласан дараалал сонгов: `FOR UPDATE SKIP
 * LOCKED` нь ижил баталгааг өгөх бөгөөд нэмэлт дэд бүтэц (Redis) шаардахгүй.
 * Нэг фитнесийн ачаалалд (өдөрт хэдэн зуун мессеж) энэ бүрэн хангалттай.
 *
 * ★ ХОЁР ЭХ СУРВАЛЖААР АЖИЛЛАНА:
 *
 *   1. **Сэрээлт** (гол зам) — `enqueue()` эсвэл `retry()` дуудагдмагц
 *      `OutboxSignal`-аар мэдэгдэнэ. Ажил ~шууд эхэлнэ.
 *   2. **Тандалт** (нөөц) — `OUTBOX_INTERVAL_MS` тутам. Сэрээлт ХҮРЭХГҮЙ
 *      гурван тохиолдлыг барина:
 *        • backoff дуусч бэлэн болсон мөр (хэн ч `enqueue` хийхгүй, зөвхөн
 *          цаг өнгөрснөөр бэлэн болсон)
 *        • өөр процессын (replica) бичсэн мөр
 *        • сервер унтарсны дараа үлдсэн `pending` мөр
 *
 * Тиймээс тандалт нь ойрхон байх шаардлагагүй — сэрээлт ирсний дараа
 * түүнийг эрс сулруулж, DB-г дэмий сэрээхээ болино.
 */
/** Сэрээгдсэн боловч мөр олдоогүй үед дахин шалгах хүртэлх хугацаа. */
const WAKE_RETRY_MS = 400;

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OutboxWorker.name);
  private running = false;
  private stopped = false;
  /** Товлогдсон сэрээлт — давхар товлохгүйн тулд. */
  private wakeTimer: NodeJS.Timeout | null = null;
  /** Ажиллаж байх зуур сэрээлт ирсэн — дуусмагц дахин ажиллана. */
  private pendingWake = false;
  /**
   * Сэрээгдсэн мөртлөө юу ч олоогүй үед НЭГ УДАА дахин оролдсон эсэх.
   *
   * Хязгаарлахгүй бол «хоосон → дахин сэрэх → хоосон» гэсэн мөнхийн
   * давталт үүсч, тандалтыг сулруулсан ач холбогдол алга болно.
   */
  private wakeRetried = false;

  constructor(
    private readonly outbox: OutboxService,
    private readonly registry: OutboxRegistry,
    private readonly config: ConfigService,
    private readonly signal: OutboxSignal,
  ) {}

  onModuleInit(): void {
    this.signal.onWake((delayMs) => this.wake(delayMs, true));
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
  }

  /**
   * Ажлыг товлох.
   *
   * @param external Гаднаас (`enqueue`/`retry`) ирсэн эсэх. Тийм бол дахин
   *   оролдох эрхийг сэргээнэ — шинэ ажил үнэхээр байгаа гэсэн үг.
   */
  private wake(delayMs = 0, external = false): void {
    if (this.stopped) return;
    if (external) this.wakeRetried = false;
    // Ажиллаж байгаа бол одоо эхлүүлж болохгүй — дуусахад нь тэмдэглэнэ.
    if (this.running) {
      this.pendingWake = true;
      return;
    }
    if (this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.run(true);
    }, delayMs);
    // Node-ийг зөвхөн энэ таймерын төлөө амьд байлгахгүй.
    this.wakeTimer.unref?.();
  }

  // ⚠ Декоратор нь ачаалах үед үнэлэгддэг тул ConfigService-ээс биш
  // process.env-ээс шууд уншина.
  // ⚠ Декоратор нь ачаалах үед үнэлэгддэг тул ConfigService-ээс биш
  // process.env-ээс шууд уншина.
  @Interval('outbox-tick', Number(process.env.OUTBOX_INTERVAL_MS ?? 15_000))
  async tick(): Promise<void> {
    await this.run(false);
  }

  /** @param fromWake Тандалт биш, сэрээлтээр ажиллаж байгаа эсэх. */
  private async run(fromWake: boolean): Promise<void> {
    // Өмнөх давталт дуусаагүй бол алгасна — давхар боловсруулахгүй.
    if (this.running || this.stopped) return;
    this.running = true;

    const batch = this.config.get<number>('outbox.batchSize') ?? 10;
    let claimed = 0;
    try {
      const rows = await this.outbox.claim(batch);
      claimed = rows.length;
      // Бүлэг тус бүрээс нэг мөр ирдэг тул эдгээрийг зэрэг боловсруулж болно.
      if (claimed) await Promise.all(rows.map((row) => this.process(row)));
    } catch (e) {
      this.log.error(`Outbox давталт унав: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }

    if (this.stopped) return;

    if (this.pendingWake || claimed === batch) {
      // Ажиллах зуур шинэ ажил ирсэн, эсвэл багц дүүрсэн (өөрөөр хэлбэл
      // үлдсэн мөр байж магадгүй) — тандалтыг хүлээхгүй.
      this.pendingWake = false;
      this.wake();
    } else if (fromWake && claimed === 0 && !this.wakeRetried) {
      // Сэрээгдсэн ч хоосон: COMMIT амжаагүй байж магадгүй. ГАНЦ УДАА
      // дахин оролдоно — үүнээс цааш тандалтад даатгана.
      this.wakeRetried = true;
      this.wake(WAKE_RETRY_MS);
    }
  }

  private async process(row: Awaited<ReturnType<OutboxService['claim']>>[number]) {
    const handler = this.registry.get(row.topic);
    if (!handler) {
      // Бүртгэгдээгүй topic — код/тохиргооны алдаа. Дахин оролдоод ямар ч
      // өөрчлөлт гарахгүй тул `PermanentError`-оор шууд `failed` болгоно.
      await this.outbox.markFailed(
        row,
        new PermanentError(`Бүртгэгдээгүй topic: ${row.topic}`),
      );
      return;
    }
    try {
      await handler(row.payload);
      await this.outbox.markDone(row.id);
    } catch (e) {
      await this.outbox.markFailed(row, e);
    }
  }
}
