import { ApiProperty } from '@nestjs/swagger';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { PageQueryDto } from './pagination.dto';

/**
 * Жагсаалтын нэгдсэн хариу. Frontend-ийн хүснэгт бүр яг энэ бүтцийг хүлээнэ —
 * шинэ жагсаалт нэмэхэд хүснэгтийн компонент өөрчлөгдөхгүй.
 */
export class PageResult<T> {
  @ApiProperty({ isArray: true })
  items: T[];

  @ApiProperty({ description: 'Шүүлтүүрт тохирсон НИЙТ мөрийн тоо' })
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty({ description: 'Нийт хуудасны тоо' })
  totalPages: number;
}

export function pageResult<T>(
  items: T[],
  total: number,
  q: PageQueryDto,
): PageResult<T> {
  const limit = q.take;
  return {
    items,
    total,
    page: q.page ?? 1,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * QueryBuilder-ээс шууд хуудаслах. `getManyAndCount()` нь мөр ба нийт тоог нэг
 * дуудлагаар авна.
 *
 * `map` нь entity-г гадагш харагдах хэлбэрт хөрвүүлнэ (нууц талбар нуух).
 */
export async function paginateQb<E extends ObjectLiteral, T = E>(
  qb: SelectQueryBuilder<E>,
  q: PageQueryDto,
  map: (row: E) => T = (row) => row as unknown as T,
): Promise<PageResult<T>> {
  const [rows, total] = await qb.skip(q.skip).take(q.take).getManyAndCount();
  return pageResult(rows.map(map), total, q);
}
