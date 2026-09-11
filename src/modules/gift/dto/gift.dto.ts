import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateGiftDto {
  @ApiProperty({ example: 600000 })
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  amount: number;

  @ApiProperty({ example: 'Болор' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  recipientName: string;

  @ApiProperty({ example: '99112233' })
  @Matches(/^\d{8}$/, { message: 'Утасны дугаар 8 оронтой байна' })
  recipientPhone: string;

  @ApiPropertyOptional({ example: 'Дорж' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  buyerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UseGiftDto {
  @ApiPropertyOptional({ description: 'Хэний эрхэд ашигласан' })
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
