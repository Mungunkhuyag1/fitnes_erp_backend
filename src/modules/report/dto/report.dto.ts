import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class DateRangeDto {
  /**
   * Сүүлийн N хоног. `from`-ын оронд ЭНИЙГ хэрэглэхийг зөвлөнө:
   * хугацааг СЕРВЕРИЙН цагаар тооцох тул клиентийн цаг зөрсөн ч тайлан
   * зөрөхгүй. `days=0` = өнөөдөр (локал өдрийн эхлэлээс).
   */
  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 3650 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  days?: number;

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00+08:00' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59+08:00' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class RevenueQueryDto extends DateRangeDto {
  /**
   * Нэгтгэх нарийвчлал.
   *
   * `week` нь ялангуяа хэрэгтэй: фитнесийн борлуулалт өдөр бүр байдаггүй тул
   * 30 хоногийг өдрөөр харуулбал график бараг хоосон, багана үзэгдэхээргүй
   * болно. Долоо хоногоор нэгтгэвэл хандлага тод харагдана.
   */
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  groupBy?: 'day' | 'week' | 'month';
}

export class AttendanceQueryDto extends DateRangeDto {
  @ApiPropertyOptional({
    enum: ['day', 'hour', 'weekday'],
    default: 'day',
    description:
      'day → өдрийн ИРЦ (өдөрт 1 хүн). hour/weekday → бүх уншуулалт (ачаалал).',
  })
  @IsOptional()
  @IsIn(['day', 'hour', 'weekday'])
  groupBy?: 'day' | 'hour' | 'weekday';
}
