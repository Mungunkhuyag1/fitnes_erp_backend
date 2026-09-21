import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';

export class ListAuditDto extends PageQueryDto {
  /**
   * Эрэмбэлэх багана — хүснэгтийн толгойн мөр дээрээс.
   *
   * ⚠ ЦАГААЖСАН ЖАГСААЛТ — энэ нь SQL түлхэлтийн хил. Утгыг шууд
   *   `ORDER BY`-д оруулдаг тул жагсаалтад байхгүй утгыг ХЭЗЭЭ Ч
   *   хүлээж авахгүй.
   */
  @ApiPropertyOptional({ enum: ['createdAt', 'action'] })
  @IsOptional()
  @IsIn(['createdAt', 'action'])
  sort?: string;

  @ApiPropertyOptional({ example: 'membership.extend' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @ApiPropertyOptional({ example: 'member' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  entity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  staffUserId?: string;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00+08:00' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
