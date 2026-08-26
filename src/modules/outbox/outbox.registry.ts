import { Injectable, Logger } from '@nestjs/common';

export type OutboxHandler = (
  payload: Record<string, unknown>,
) => Promise<void>;

/**
 * Topic → боловсруулагч.
 *
 * Модуль бүр өөрийн topic-оо `onModuleInit`-д бүртгэнэ. Ингэснээр outbox нь
 * device/loopy/notify модулиудаас ХАМААРАХГҮЙ (эсрэг чиглэлийн хамаарал) —
 * тойрог хамаарал үүсэхгүй, шинэ topic нэмэхэд outbox-ийг хөндөхгүй.
 */
@Injectable()
export class OutboxRegistry {
  private readonly log = new Logger(OutboxRegistry.name);
  private readonly handlers = new Map<string, OutboxHandler>();

  register(topic: string, handler: OutboxHandler): void {
    if (this.handlers.has(topic)) {
      throw new Error(`Outbox topic давхардлаа: ${topic}`);
    }
    this.handlers.set(topic, handler);
    this.log.log(`Topic бүртгэв: ${topic}`);
  }

  get(topic: string): OutboxHandler | undefined {
    return this.handlers.get(topic);
  }

  topics(): string[] {
    return [...this.handlers.keys()];
  }
}
