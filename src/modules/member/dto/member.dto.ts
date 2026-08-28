import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';
import { CardStage } from '../../../common/enums/card-stage.enum';
import { Gender } from '../../../common/enums/gender.enum';
import { MemberStatus } from '../../../common/enums/member-status.enum';

/**
 * Хоосон мөрийг `null` болгоно.
 *
 * Засах формоос талбарыг ЦЭВЭРЛЭХЭД `''` ирдэг. `@IsOptional()` нь зөвхөн
 * `null`/`undefined`-ыг алгасдаг тул `''` шууд `@IsEmail`, `@Matches`-д
 * очиж унана — өөрөөр хэлбэл бөглөсөн утгаа хэзээ ч устгаж чадахгүй болно.
 * Иймд шалгахаас ӨМНӨ хөрвүүлнэ. `undefined` хэвээр үлдэнэ: «хөндөөгүй»
 * болон «цэвэрлэсэн» хоёр өөр утгатай.
 */
const emptyToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : undefined;

export class CreateMemberDto {
  @ApiProperty({ example: 'Батаа' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({
    example: '99112233',
    description: '+976, зай, зураас зөвшөөрнө — 8 орон болгож нормчилно',
  })
  @IsString()
  @MaxLength(20)
  phone: string;

  @Transform(emptyToNull)
  @ApiPropertyOptional({ example: 'bataa@example.mn' })
  @IsOptional()
  @IsEmail({}, { message: 'И-мэйл хаяг буруу байна' })
  @MaxLength(160)
  email?: string | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional({ example: '1995-03-14', description: 'YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Огноо YYYY-MM-DD хэлбэртэй байна' })
  birthDate?: string | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional({ description: 'Яаралтай үед холбоо барих хүн' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  emergencyName?: string | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyPhone?: string | null;
}

export class UpdateMemberDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @Transform(emptyToNull)
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'И-мэйл хаяг буруу байна' })
  @MaxLength(160)
  email?: string | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional({ example: '1995-03-14' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Огноо YYYY-MM-DD хэлбэртэй байна' })
  birthDate?: string | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  emergencyName?: string | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyPhone?: string | null;
}

export class ListMembersDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Утасгүй гишүүд (Loopy холбогдохгүй)' })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true ? true : undefined,
  )
  @IsBoolean()
  noPhone?: boolean;

  @ApiPropertyOptional({ description: 'Нэр эсвэл утсаар хайх' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: MemberStatus })
  @IsOptional()
  @IsEnum(MemberStatus)
  status?: MemberStatus;

  @ApiPropertyOptional({
    description: 'N хоногийн дотор эрх нь дуусах (зөвхөн идэвхтэй)',
    example: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  expiring?: number;

  @Transform(emptyToNull)
  @ApiPropertyOptional({
    enum: CardStage,
    description: 'Wallet картын явцаар шүүх (not_allowed = засвар шаардлагатай)',
  })
  @IsOptional()
  @IsEnum(CardStage)
  cardStage?: CardStage;

  @ApiPropertyOptional({ enum: Gender, description: 'Хүйсээр шүүх' })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @ApiPropertyOptional({ description: 'Царай бүртгэсэн эсэх' })
  @IsOptional()
  @Transform(toBool)
  faceEnrolled?: boolean;

  @ApiPropertyOptional({ description: 'Wallet карттай эсэх' })
  @IsOptional()
  @Transform(toBool)
  hasCard?: boolean;

  @ApiPropertyOptional({ description: 'Төхөөрөмж рүү бичихэд алдаа гарсан' })
  @IsOptional()
  @Transform(toBool)
  syncError?: boolean;

  @ApiPropertyOptional({
    enum: ['name', 'endsAt', 'createdAt', 'memberNo', 'lastVisit'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['name', 'endsAt', 'createdAt', 'memberNo', 'lastVisit'])
  sort?: string;
}
