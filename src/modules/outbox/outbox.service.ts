import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { pageResult, type PageResult } from '../../common/dto/paginated';
import type { ListOutboxDto } from './dto/outbox.dto';
import { loadMembers } from '../../common/utils/enrich.util';
import { PermanentError } from './outbox.errors';
import { OutboxMessage, OutboxStatus } from './outbox.entity';
import { OutboxSignal } from './outbox.signal';

export interface EnqueueInput {
  topic: string;
  payload: Record<string, unknown>;
  /** Ижил түлхүүртэй мессежүүд дарааллаараа боловсруулагдана. */
  groupKey?: string;
}

/**
 * Транзакц дотор бичигдсэн мөрийн COMMIT-ыг хүлээх хугацаа.
 *
 * Хэт бага бол worker хоосон эргэнэ (нэг нэмэлт асуулга — аюулгүй, доор
 * дахин оролдоно). Хэт их бол sync удаашрана. 100мс нь ердийн COMMIT-д
 * элбэг хангалттай.
 */
const WAKE_AFTER_COMMIT_MS = 100;

@Injectable()
export class OutboxService {
  private readonly log = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxMessage)
    private readonly repo: Repository<OutboxMessage>,
    private readonly ds: DataSource,
    private readonly config: ConfigService,
    private readonly signal: OutboxSignal,
  ) {}

  /**
   * Дараалалд нэмэх.
   *
   * `manager` дамжуулбал ТУХАЙН транзакцад бичигдэнэ — бизнесийн өөрчлөлт ба
   * outbox мөр атомарт байх ёстой (аль нэг нь дутвал систем зөрнө).
   */
  async enqueue(
    input: EnqueueInput | EnqueueInput[],
    manager?: EntityManager,
  ): Promise<void> {
    const list = Array.isArray(input) ? input : [input];
    if (!list.length) return;
    const repo = manager
      ? manager.getRepository(OutboxMessage)
      : this.repo;
    // `jsonb` баганад TypeORM-ын DeepPartial нь `Record<string, unknown>`-ыг
    // шууд авдаггүй тул entity үүсгээд хадгална.
    await repo.save(
      list.map((i) =>
        repo.create({
          topic: i.topic,
          payload: i.payload,
          groupKey: i.groupKey ?? null,
          status: OutboxStatus.PENDING,
        }),
      ),
    );

    // ★ Worker-ыг ШУУД сэрээнэ — дараагийн тандалтыг хүлээхгүй.
    //
    // `manager` дамжуулсан бол бид транзакц ДОТОР байгаа: мөр бичигдсэн ч
    // COMMIT болоогүй тул worker одоо очвол юу ч олохгүй. Тиймээс COMMIT
    // амжих зай өгнө. Транзакцгүй бол аль хэдийн бичигдсэн — саатал хэрэггүй.
    this.signal.wake(manager ? WAKE_AFTER_COMMIT_MS : 0);
  }

  /**
   * Боловсруулах мөрүүдийг «эзэмших» (claim).
   *
   * Гурван зүйлийг зэрэг хангана:
   *  1. `FOR UPDATE SKIP LOCKED` — олон worker зэрэг ажиллаж болно
   *  2. `DISTINCT ON (group)` — бүлэг тус бүрээс зөвхөн ХАМГИЙН ЭРТ мөр
   *  3. Backoff-д байгаа толгой мөр нь бүлгээ хааж барина — дараалал алдагдахгүй
   *
   * (2)+(3) хосолсноор ижил гишүүний командууд хэзээ ч солбихгүй.
   */
  async claim(limit: number): Promise<OutboxMessage[]> {
    return this.ds.transaction(async (m) => {
      const rows = await m.query<OutboxMessage[]>(
        `
        WITH head AS (
          SELECT DISTINCT ON (COALESCE(group_key, id::text))
                 id, next_attempt_at
          FROM outbox
          WHERE status = 'pending'
          ORDER BY COALESCE(group_key, id::text), created_at, id
        )
        SELECT o.*
        FROM outbox o
        JOIN head h ON h.id = o.id
        WHERE h.next_attempt_at <= now()
        ORDER BY o.created_at
        LIMIT $1
        FOR UPDATE OF o SKIP LOCKED
        `,
        [limit],
      );
      if (rows.length) {
        // Эзэмшсэн мөрүүдийг тэр даруй хойшлуулж, өөр worker дахин авахаас
        // сэргийлнэ (транзакц дуусмагц түгжээ суларна).
        await m.query(
          `UPDATE outbox SET next_attempt_at = now() + interval '60 seconds'
           WHERE id = ANY($1::bigint[])`,
          [rows.map((r) => r.id)],
        );
      }
      return rows;
    });
  }

  async markDone(id: string): Promise<void> {
    await this.repo.update(id, {
      status: OutboxStatus.DONE,
      lastError: null,
      processedAt: new Date(),
    });
  }

  /** Алдааг ангилж, дахин оролдох эсэхийг шийднэ. */
  async markFailed(row: OutboxMessage, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = row.attempts + 1;
    const backoff = this.backoffSeconds();
    const permanent =
      error instanceof PermanentError || attempts >= backoff.length;

    if (permanent) {
      this.log.error(
        `Outbox #${row.id} ${row.topic} эцсийн байдлаар амжилтгүй (${attempts} оролдлого): ${message}`,
      );
      await this.repo.update(row.id, {
        status: OutboxStatus.FAILED,
        attempts,
        lastError: message.slice(0, 1000),
        processedAt: new Date(),
      });
      return;
    }

    const delay = backoff[attempts - 1];
    this.log.warn(
      `Outbox #${row.id} ${row.topic} амжилтгүй (${attempts}) — ${delay}с дараа дахин: ${message}`,
    );
    await this.repo.update(row.id, {
      attempts,
      lastError: message.slice(0, 1000),
      nextAttemptAt: new Date(Date.now() + delay * 1000),
    });
  }

  // ── Хяналт (dashboard) ──

  /**
   * ⚠ DTO-г БҮТНЭЭР дамжуулна. `{ ...q, extra }` гэж тараавал `skip`/`take`
   * getter-үүд (prototype дээр байдаг) алдагдаж, хуудаслалт эвдэрнэ.
   */
  async list(q: ListOutboxDto) {
    const qb = this.repo.createQueryBuilder('o');
    if (q.status) qb.andWhere('o.status = :s', { s: q.status });
    if (q.topic) qb.andWhere('o.topic = :t', { t: q.topic });
    qb.orderBy('o.created_at', q.order ? q.direction : 'DESC');
    const [rows, total] = await qb.skip(q.skip).take(q.take).getManyAndCount();

    // Дараалал дахь мөр бүр ХЭНД хамаатайг харуулна. Үүнгүй бол
    // «loopy.extend амжилтгүй» гэсэн мөр хэнийх нь болох нь тодорхойгүй
    // тул ажилтан шийдвэрлэх боломжгүй.
    const members = await loadMembers(
      this.ds,
      rows.map((r) => r.payload?.memberId as string | undefined),
    );

    return pageResult(
      rows.map((r) => {
        const m = members.get((r.payload?.memberId as string) ?? '');
        return {
          ...r,
          memberId: m?.id ?? null,
          memberName: m?.name ?? null,
          memberNo: m?.memberNo ?? null,
          // `disallowPhone` нь memberId-гүй — зөвхөн утас агуулна.
          phone: (r.payload?.phone as string | undefined) ?? null,
        };
      }),
      total,
      q,
    );
  }

  /** Гараар дахин оролдох (`failed` → `pending`). */
  async retry(id: string): Promise<void> {
    await this.repo.update(id, {
      status: OutboxStatus.PENDING,
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      processedAt: null,
    });
    // ⚠ Энэ нь `enqueue` дуудахгүй, зөвхөн төлөв солино. Сэрээхгүй бол
    // /sync дэлгэцийн «Дахин» товч дарсны дараа ажилтан тандалтын
    // интервал дуустал хүлээх байсан.
    this.signal.wake();
  }

  async stats(): Promise<Record<string, number>> {
    const rows = await this.repo
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('o.status')
      .getRawMany<{ status: string; count: string }>();
    const out: Record<string, number> = { pending: 0, done: 0, failed: 0 };
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }

  private backoffSeconds(): number[] {
    const raw = this.config.get<string>('outbox.backoffSec');
    const parsed = (raw ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    return parsed.length ? parsed : [60, 300, 1800, 7200, 21600];
  }
}
