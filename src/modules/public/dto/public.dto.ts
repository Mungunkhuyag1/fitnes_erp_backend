import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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
