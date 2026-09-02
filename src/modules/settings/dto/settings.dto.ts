import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    description: 'Ресепшн ажилтан бэлнээр эрх сунгаж болох уу',
  })
  @IsOptional()
  @IsBoolean()
  allow_reception_extend?: boolean;

  @ApiPropertyOptional({ example: ['T-7', 'T-3', 'T-1', 'T0'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reminder_milestones?: string[];

  @ApiPropertyOptional({ example: 'WinFit' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  gym_name?: string;

  @ApiPropertyOptional({ example: ['Эрэгтэй', 'Эмэгтэй'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locker_zones?: string[];

  @ApiPropertyOptional({
    example: { male: 'Эрэгтэй', female: 'Эмэгтэй' },
    description: 'Хүйс → шүүгээний өрөө. Утга нь locker_zones доторх нэр байна.',
  })
  @IsOptional()
  @IsObject()
  @Transform(({ value }: { value: unknown }) => {
    // class-validator-ийн `each` нь массивт зориулагдсан — объектын утгыг
    // шалгадаггүй. Тиймээс түлхүүр, утга хоёуланг гараар шалгана: танихгүй
    // түлхүүр чимээгүй хадгалагдаад хэзээ ч ажиллахгүй байхаас сэргийлнэ.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!['male', 'female', 'other'].includes(k)) {
          throw new BadRequestException(`Танихгүй хүйс: ${k}`);
        }
        if (typeof v !== 'string') {
          throw new BadRequestException(`${k} — өрөөний нэр мөр байх ёстой`);
        }
      }
    }
    return value;
  })
  locker_zone_by_gender?: Record<string, string>;

  @ApiPropertyOptional({ example: 30000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  locker_price_per_month?: number;
  @ApiPropertyOptional({ example: 30, description: 'Жилд хамгийн ихдээ' })
  @IsOptional()
  @IsInt()
  @Min(0)
  freeze_days_per_year?: number;

  @ApiPropertyOptional({ example: 14, description: 'Нэг удаад дээд тал' })
  @IsOptional()
  @IsInt()
  @Min(1)
  freeze_max_once?: number;

  @ApiPropertyOptional({ example: 3, description: 'Хамгийн багадаа' })
  @IsOptional()
  @IsInt()
  @Min(1)
  freeze_min_days?: number;

}
