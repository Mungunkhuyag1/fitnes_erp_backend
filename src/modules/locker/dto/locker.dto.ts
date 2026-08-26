import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
import { LockerAssignmentType } from '../locker-assignment.entity';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : undefined;

/** Шүүгээг заах — ӨРӨӨ + ДУГААР хос (дугаар дангаараа хангалтгүй). */
export class LockerRefDto {
  @ApiProperty({ example: 'Эрэгтэй', description: 'Хувцас солих өрөө' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  zone: string;

  @ApiProperty({ example: 42, description: 'Шүүгээ = түлхүүрийн дугаар' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99999)
  number: number;
}

export class IssueLockerDto extends LockerRefDto {
  @ApiProperty()
  @IsUUID()
  memberId: string;

  @ApiProperty({ enum: LockerAssignmentType, default: LockerAssignmentType.DAILY })
  @IsEnum(LockerAssignmentType)
  type: LockerAssignmentType;

  @ApiPropertyOptional({
    example: 30,
    description: 'Түрээсийн хоног (зөвхөн `rental`)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  days?: number;

  @ApiPropertyOptional({ example: 30000, description: 'Түрээсийн төлбөр (₮)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ReturnLockerDto extends LockerRefDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CreateLockerDto extends LockerRefDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateLockerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @ApiPropertyOptional({ description: 'Эвдэрсэн бол false — олгох боломжгүй болно' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListLockersDto extends PageQueryDto {
  @ApiPropertyOptional({ example: 'Эрэгтэй' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  zone?: string;

  @ApiPropertyOptional({ description: 'Зөвхөн сул / зөвхөн эзэлсэн' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  occupied?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  active?: boolean;
}

export class ListAssignmentsDto extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({ example: 'Эрэгтэй' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  zone?: string;

  @ApiPropertyOptional({ enum: LockerAssignmentType })
  @IsOptional()
  @IsEnum(LockerAssignmentType)
  type?: LockerAssignmentType;

  @ApiPropertyOptional({ description: 'Түлхүүр гарсан хэвээр эсэх' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  outstanding?: boolean;

  @ApiPropertyOptional({ description: 'Хугацаа хэтэрсэн түрээс' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overdue?: boolean;
}
