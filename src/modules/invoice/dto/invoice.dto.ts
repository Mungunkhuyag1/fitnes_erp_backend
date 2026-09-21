import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  IsIn,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';
import { InvoiceStatus } from '../../../common/enums/member-status.enum';

export class CreateInvoiceDto {
  @ApiProperty()
  @IsUUID()
  memberId: string;

  @ApiProperty()
  @IsUUID()
  packageId: string;

  /**
   * Хосын багцын хамтрагч.
   *
   * ⚠ `seats = 2` багцад ЗААВАЛ. Хоёулаа зэрэг бүртгүүлэх шийдвэрийн
   * үр дүн — ресепшн дээр хоёулаа байгаа тул сонгох нь хормын ажил.
   */
  @ApiPropertyOptional({ description: 'Хосын багцын хоёр дахь гишүүн' })
  @IsOptional()
  @IsUUID()
  partnerMemberId?: string;
}

export class ListInvoicesDto extends PageQueryDto {
  /**
   * Эрэмбэлэх багана — хүснэгтийн толгойн мөр дээрээс.
   *
   * ⚠ ЦАГААЖСАН ЖАГСААЛТ — энэ нь SQL түлхэлтийн хил. Утгыг шууд
   *   `ORDER BY`-д оруулдаг тул жагсаалтад байхгүй утгыг ХЭЗЭЭ Ч
   *   хүлээж авахгүй.
   */
  @ApiPropertyOptional({ enum: ['createdAt', 'paidAt', 'amount', 'status'] })
  @IsOptional()
  @IsIn(['createdAt', 'paidAt', 'amount', 'status'])
  sort?: string;

  @ApiPropertyOptional({ description: 'Гишүүний нэр эсвэл утсаар хайх' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ description: 'Багцаар шүүх' })
  @IsOptional()
  @IsUUID()
  packageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

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
