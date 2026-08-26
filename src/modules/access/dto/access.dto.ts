import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';
import { AccessReason } from '../access-event.entity';

export class ListAccessEventsDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Гишүүний нэр эсвэл утсаар хайх' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiPropertyOptional({ description: 'Зөвшөөрсөн / татгалзсан' })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : undefined,
  )
  @IsBoolean()
  granted?: boolean;

  @ApiPropertyOptional({ enum: AccessReason })
  @IsOptional()
  @IsEnum(AccessReason)
  reason?: AccessReason;

  /** Сүүлийн N хоног (серверийн цагаар). `0` = өнөөдөр. */
  @ApiPropertyOptional({ example: 7, minimum: 0, maximum: 3650 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  days?: number;

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

/** Зөвхөн хөгжүүлэлтэд — терминалын эвентийг дуурайлгах. */
export class SimulateAccessDto {
  @ApiProperty()
  @IsUUID()
  memberId: string;

  @ApiPropertyOptional({ default: 0, description: 'Хэдэн минутын өмнө болсон' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minutesAgo?: number;
}
