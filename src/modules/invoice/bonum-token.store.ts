import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { IntegrationToken } from './integration-token.entity';

export interface Backoff {
  until: Date;
  error: string;
}

/**
 * Bonum-ын токен хадгалах сан.
 *
 * ХОЁР ХЭРЭГЖҮҮЛЭЛТ, НЭГ ИНТЕРФЕЙС:
 *
 *   `REDIS_URL` тохируулсан  → Redis   (production, олон replica)
 *   тохируулаагүй            → Postgres (локал хөгжүүлэлт)
 *
 * ЯАГААД ЗАДГАЙ ҮЛДЭЭВ: Redis-ийн public URL-ыг локал дээр ч хэрэглэж
 * болох боловч тэгвэл хөгжүүлэлт production-ы токеныг ХУВААЛЦАНА —
 * локалд `clear()` дуудахад production дахин auth хийхээс өөр аргагүй
 * болно. Тусад нь байлгах нь аюулгүй.
 */
export interface BonumTokenStore {
  getAccess(): Promise<string | null>;
  getRefresh(): Promise<string | null>;
  save(access: string, ttlSec: number, refresh: string | null): Promise<void>;
  clear(): Promise<void>;
  getBackoff(): Promise<Backoff | null>;
  setBackoff(sec: number, error: string): Promise<void>;
  readonly kind: 'redis' | 'postgres';
}

/** Refresh token-ы хадгалах хугацаа — Bonum-ынх ихэвчлэн 24 цаг. */
const REFRESH_TTL_SEC = 86_400;

// ══════════════════════════════════════════════════════════════════
//  Redis
// ══════════════════════════════════════════════════════════════════

class RedisStore implements BonumTokenStore {
  readonly kind = 'redis' as const;
  private readonly A = 'bonum:accessToken';
  private readonly R = 'bonum:refreshToken';
  private readonly B = 'bonum:backoff';

  constructor(private readonly redis: Redis) {}

  getAccess(): Promise<string | null> {
    return this.redis.get(this.A);
  }

  getRefresh(): Promise<string | null> {
    return this.redis.get(this.R);
  }

  async save(access: string, ttlSec: number, refresh: string | null): Promise<void> {
    // ⚠ TTL-ийг Bonum-ын `expiresIn`-ээс авна. Тогтмол 3600 бичвэл токен
    // эрт хүчингүй болоход кэш «хүчинтэй» гэж худал хэлж, 401 үүснэ.
    const tx = this.redis.multi().set(this.A, access, 'EX', ttlSec).del(this.B);
    if (refresh) tx.set(this.R, refresh, 'EX', REFRESH_TTL_SEC);
    await tx.exec();
  }

  async clear(): Promise<void> {
    await this.redis.del(this.A, this.R);
  }

  async getBackoff(): Promise<Backoff | null> {
    const raw = await this.redis.get(this.B);
    if (!raw) return null;
    const ttl = await this.redis.ttl(this.B);
    return {
      until: new Date(Date.now() + Math.max(0, ttl) * 1000),
      error: raw,
    };
  }

  async setBackoff(sec: number, error: string): Promise<void> {
    // Түлхүүр өөрөө хугацаагаараа устдаг тул цэвэрлэх ажил хэрэггүй.
    await this.redis.set(this.B, error.slice(0, 300), 'EX', sec);
  }
}

// ══════════════════════════════════════════════════════════════════
//  Postgres
// ══════════════════════════════════════════════════════════════════

class PgStore implements BonumTokenStore {
  readonly kind = 'postgres' as const;
  private static readonly PROVIDER = 'bonum';

  constructor(private readonly ds: DataSource) {}

  private repo() {
    return this.ds.getRepository(IntegrationToken);
  }

  private row() {
    return this.repo().findOne({ where: { provider: PgStore.PROVIDER } });
  }

  async getAccess(): Promise<string | null> {
    const r = await this.row();
    if (!r?.accessToken || r.expiresAt <= new Date()) return null;
    return r.accessToken;
  }

  async getRefresh(): Promise<string | null> {
    const r = await this.row();
    return r?.refreshToken ?? null;
  }

  async save(access: string, ttlSec: number, refresh: string | null): Promise<void> {
    await this.upsert({
      accessToken: access,
      expiresAt: new Date(Date.now() + ttlSec * 1000),
      ...(refresh ? { refreshToken: refresh } : {}),
      retryAfter: null,
      lastError: null,
    });
  }

  async clear(): Promise<void> {
    await this.upsert({
      accessToken: '',
      expiresAt: new Date(0),
      refreshToken: null,
    });
  }

  async getBackoff(): Promise<Backoff | null> {
    const r = await this.row();
    if (!r?.retryAfter || r.retryAfter <= new Date()) return null;
    return { until: r.retryAfter, error: r.lastError ?? '' };
  }

  async setBackoff(sec: number, error: string): Promise<void> {
    await this.upsert({
      retryAfter: new Date(Date.now() + sec * 1000),
      lastError: error.slice(0, 300),
    });
  }

  /** Зөвхөн дамжуулсан баганыг шинэчилнэ — бусад утга хэвээр үлдэнэ. */
  private async upsert(patch: Partial<IntegrationToken>): Promise<void> {
    const COLUMN: Record<string, string> = {
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      expiresAt: 'expires_at',
      retryAfter: 'retry_after',
      lastError: 'last_error',
    };
    await this.repo()
      .createQueryBuilder()
      .insert()
      .into(IntegrationToken)
      .values({
        provider: PgStore.PROVIDER,
        accessToken: patch.accessToken ?? '',
        refreshToken: patch.refreshToken ?? null,
        expiresAt: patch.expiresAt ?? new Date(0),
        retryAfter: patch.retryAfter ?? null,
        lastError: patch.lastError ?? null,
      })
      .orUpdate(
        Object.keys(patch).map((k) => COLUMN[k] ?? k),
        ['provider'],
      )
      .execute();
  }
}

// ══════════════════════════════════════════════════════════════════
//  Factory
// ══════════════════════════════════════════════════════════════════

@Injectable()
export class BonumTokenStoreFactory implements OnModuleDestroy {
  private readonly log = new Logger(BonumTokenStoreFactory.name);
  private redis: Redis | null = null;
  readonly store: BonumTokenStore;

  constructor(
    config: ConfigService,
    @InjectDataSource() ds: DataSource,
  ) {
    const url = config.get<string>('redis.url');
    if (url) {
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 3,
        // Redis унасан үед хүсэлт МӨНХ хүлээхгүй — алдаа шидээд backoff-д
        // ороход нь илүү. Чимээгүй өлгөөстэй байхаас дээр.
        enableOfflineQueue: false,
        lazyConnect: false,
      });
      this.redis.on('error', (e) =>
        this.log.warn(`Redis алдаа: ${e.message}`),
      );
      this.store = new RedisStore(this.redis);
      this.log.log('Bonum токен: Redis');
    } else {
      this.store = new PgStore(ds);
      this.log.log('Bonum токен: Postgres (REDIS_URL тохируулаагүй)');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}
