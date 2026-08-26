import { Injectable } from '@nestjs/common';

/**
 * `OutboxService` → `OutboxWorker` чиглэлийн дохио.
 *
 * ЯАГААД ТУСДАА КЛАСС ВЭ: `OutboxWorker` нь `OutboxService`-ээс хамаардаг.
 * Хэрэв service нь worker-ыг шууд дуудвал **дугуй хамаарал** үүсч Nest
 * ачаалагдахаа болино. Энэ жижиг класс нь хоёуланд нь мэдэгдэх ганц цэг
 * болж, чиглэлийг тасалж өгнө.
 */
@Injectable()
export class OutboxSignal {
  private listener: ((delayMs: number) => void) | null = null;

  /** Worker нь өөрийгөө бүртгүүлнэ. */
  onWake(fn: (delayMs: number) => void): void {
    this.listener = fn;
  }

  /**
   * «Ажил нэмэгдлээ» гэж мэдэгдэнэ.
   *
   * @param delayMs Хэдэн мс-ийн дараа шалгах. Транзакц дотор бичсэн бол
   *   COMMIT болохыг хүлээх бага зэрэг саатал өгнө — эс бөгөөс worker
   *   мөрийг олохгүй.
   */
  wake(delayMs = 0): void {
    this.listener?.(delayMs);
  }
}
