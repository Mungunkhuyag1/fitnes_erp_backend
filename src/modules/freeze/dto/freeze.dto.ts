import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateGlobalFreezeDto {
  @ApiProperty({ example: 'Наадмын амралт' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason: string;

  @ApiProperty({ example: '2026-07-11' })
  @Type(() => Date)
  @IsDate()
  startsAt: Date;

  @ApiProperty({ example: '2026-07-13' })
  @Type(() => Date)
  @IsDate()
  endsAt: Date;
}

export class CreateMemberFreezeDto {
  @ApiProperty()
  @IsUUID()
  memberId: string;

  @ApiProperty({ example: 14, description: 'Хэдэн хоног' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number;

  @ApiProperty({ example: 'Гадаадад явсан' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason: string;
}

export class EndFreezeDto {
  @ApiPropertyOptional({ example: 'Эрт буцаж ирсэн' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
