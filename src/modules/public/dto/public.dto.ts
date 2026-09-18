import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LookupDto {
  @ApiProperty({ example: '99112233' })
  @IsString()
  @MaxLength(20)
  phone: string;
}

export class PublicInvoiceDto {
  @ApiPropertyOptional({ description: 'Токентой линкээр орсон бол' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  token?: string;

  @ApiPropertyOptional({ description: 'Утсаар орсон бол' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty()
  @IsUUID()
  packageId: string;
}

/**
 * Онлайн өөрөө бүртгүүлэх.
 *
 * ⚠ ЗӨВХӨН нэр, утас. Хүйс, төрсөн огноо, яаралтай холбоо барих хүн нь
 * ресепшний ажил: анх удаа орж ирсэн хүнээс хувийн мэдээллийн бүтэн
 * маягт нэхэх нь бүртгэлийг тасалдаг.
 */
export class PublicRegisterDto {
  @ApiProperty({ example: 'Батаа' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: '99112233' })
  @IsString()
  @MaxLength(20)
  phone: string;
}
