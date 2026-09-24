import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateYogaClassDto {
  @ApiProperty({ example: 'Хатха йог — үдээс хойш' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ example: 'Сараа багш' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  instructor?: string;

  @ApiProperty({ example: '2026-09-25T11:00:00.000Z' })
  @IsISO8601()
  startsAt: string;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMin?: number;

  @ApiPropertyOptional({ example: 12, description: 'Хүний дээд тоо' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  capacity?: number;

  @ApiPropertyOptional({ example: 25000, description: 'Нэг хүний төлбөр (₮)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Долоо хоног тутам ХЭДЭН удаа давтаж үүсгэх вэ.
   *
   * ★ ЯАГААД ДҮРЭМ БИШ, МӨР ВЭ
   *
   * Хуваарийг дүрмээр хадгалбал нэг өдрийн хичээлийг цуцлах, багшийг
   * нь солих, оролцогч хавсаргах боломжгүй болно. Бодит мөр үүсгэх нь
   * илүү олон мөр гаргах ч ажилтан тус бүрийг нь чөлөөтэй засна.
   *
   * ⚠ 1 = зөвхөн тэр өдөр. Дээд тал нь 52 (нэг жил).
   */
  @ApiPropertyOptional({
    example: 8,
    description: '7 хоног тутам давтах тоо (1 = давтахгүй)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52)
  repeatWeeks?: number;
}

export class UpdateYogaClassDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  instructor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** `true` → цуцлах, `false` → цуцлалтыг буцаах. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  cancelled?: boolean;
}

export class ListYogaClassesDto {
  @ApiPropertyOptional({ description: 'Эндээс хойшхи (ISO)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Эн хүртэлх (ISO)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Цуцалсныг ч харуулах уу. Анхдагчаар ҮГҮЙ. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeCancelled?: boolean;
}

export class CreateYogaBookingDto {
  /**
   * WinFit-ийн гишүүн бол холбоно.
   *
   * ⚠ ЗААВАЛ БИШ: йогт гишүүн биш хүн ирж болно. Холбовол нэрийг нь
   * гишүүний бүртгэлээс автоматаар авна.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({
    example: 'Дорж Бат',
    description: 'Гишүүн биш бол ЗААВАЛ',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ example: '99112233' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: 25000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount?: number;

  /** `true` → мөнгө хараахан аваагүй (авлага). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  payLater?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateYogaBookingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount?: number;

  /** `true` → төлөгдсөн, `false` → авлага болгох. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  /** `true` → ирсэн, `false` → ирээгүй. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  attended?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
