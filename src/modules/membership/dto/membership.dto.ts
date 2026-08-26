import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';
import { MembershipSource } from '../../../common/enums/member-status.enum';

/** Ажилтан гараар сунгах — `bonum` нь нэхэмжлэхийн урсгалаар ирнэ (B8). */
export class ExtendMembershipDto {
  @ApiPropertyOptional({ description: 'Багцаар сунгах' })
  @IsOptional()
  @IsUUID()
  packageId?: string;

  @ApiPropertyOptional({
    description: 'Эсвэл шууд хоногоор (багцгүй). `reason` заавал болно.',
    minimum: 1,
    maximum: 3650,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;

  @ApiProperty({ example: 90000, description: 'Хүлээн авсан дүн (₮)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount: number;

  @ApiProperty({ enum: [MembershipSource.CASH, MembershipSource.MANUAL] })
  @IsEnum(MembershipSource)
  method: MembershipSource;

  @ApiPropertyOptional({ example: 'Бэлнээр 1 сар' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiProperty({ description: 'Давхар сунгахаас хамгаална (uuid)' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey: string;
}

export class ReverseMembershipDto {
  @ApiProperty({ example: 'Буруу бүртгэсэн' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class MemberActionDto {
  @ApiProperty({ example: 'Гишүүний хүсэлтээр' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class ListMembershipsDto extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({ enum: MembershipSource })
  @IsOptional()
  @IsEnum(MembershipSource)
  source?: MembershipSource;

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
