import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PromotionChannel, PromotionKind } from '../promotion.entity';

export class CreatePromotionDto {
  @ApiProperty({ example: 'Наадмын хямдрал' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: PromotionKind })
  @IsEnum(PromotionKind)
  kind: PromotionKind;

  @ApiProperty({ example: 20, description: 'Хувь / төгрөг / хоног' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  value: number;

  @ApiPropertyOptional({ description: 'Хоосон = бүх багцад' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  packageIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startsAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date;

  @ApiPropertyOptional({ enum: PromotionChannel, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PromotionChannel, { each: true })
  channels?: PromotionChannel[];

  @ApiPropertyOptional({
    description:
      'Давхарлахыг зогсоох — зөвхөн энэ урамшуулал үйлчилнэ. `fixed_price` үргэлж онцгой.',
  })
  @IsOptional()
  @IsBoolean()
  exclusive?: boolean;

  @ApiPropertyOptional({
    example: 0,
    description: 'Давхарлах дараалал — их нь түрүүлж хэрэглэгдэнэ',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdatePromotionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: PromotionKind })
  @IsOptional()
  @IsEnum(PromotionKind)
  kind?: PromotionKind;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  packageIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startsAt?: Date | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date | null;

  @ApiPropertyOptional({ enum: PromotionChannel, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PromotionChannel, { each: true })
  channels?: PromotionChannel[];

  @ApiPropertyOptional({
    description:
      'Давхарлахыг зогсоох — зөвхөн энэ урамшуулал үйлчилнэ. `fixed_price` үргэлж онцгой.',
  })
  @IsOptional()
  @IsBoolean()
  exclusive?: boolean;

  @ApiPropertyOptional({
    example: 0,
    description: 'Давхарлах дараалал — их нь түрүүлж хэрэглэгдэнэ',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}
