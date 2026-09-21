import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Хуудаслалтын дээд хязгаар — нэг хүсэлтээр DB-г дарахаас сэргийлнэ.
 *
 * Дэлгэц нь 50/100/150/200 гэсэн сонголт болохоор дээд тал нь 200.
 * Энээс дээш тавих нь байдалыг сайжруулахгүй: 200 мөрөөс цааш
 * хүн скроллоор хайхаа болино — шүүлтүүр хэрэглэх нь зөв.
 */
export const MAX_LIMIT = 200;

/**
 * Анхдагч хэмжээ.
 *
 * ⚠ 20 байсан нь хэт бага байв: 350 гишүүнтэй зааланд энэ нь
 * 18 хуудас болно. Ажилтан хуудас солих бүрд сервер рүү очдог.
 */
export const DEFAULT_LIMIT = 50;

/**
 * Жагсаалтын БҮХ endpoint энэ DTO-г өвлөнө — систем даяар нэг ижил
 * `page` / `limit` / `order` нэр, ижил хязгаартай.
 */
export class PageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: DEFAULT_LIMIT, maximum: MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  order?: string;

  /** Хэдэн мөр алгасах (`skip`). */
  get skip(): number {
    return ((this.page ?? 1) - 1) * this.take;
  }

  get take(): number {
    return Math.min(MAX_LIMIT, Math.max(1, this.limit ?? DEFAULT_LIMIT));
  }

  get direction(): 'ASC' | 'DESC' {
    return (this.order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  }
}
