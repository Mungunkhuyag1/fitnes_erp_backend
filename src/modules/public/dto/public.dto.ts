import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Gender } from '../../../common/enums/gender.enum';

/** Хоосон мөрийг `null` — сонголтот талбарыг бөглөөгүй үед `''` ирдэг. */
const emptyToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

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
 * ★ Хүйс, төрсөн огноог маягт ЗААВАЛ болгодог — ресепшн дээр нөхөх
 * алхмыг хасна. И-мэйл, яаралтай холбоо барих хүн сонголтот: хэт урт
 * маягт бүртгэлийг тасалдаг.
 *
 * ⚠ Энд бүгд `@IsOptional` — `forbidNonWhitelisted` идэвхтэй тул заавал
 * болговол landing (Vercel) ба backend (Railway) хоёрын deploy-ын
 * хооронд аль дараалал нь ч бүртгэлийг хэдэн минут эвдэнэ, хуучин
 * кэштэй хуудас ч унана. Хэлбэрийг нь шалгасаар байна.
 *
 * ⚠ Регистрийн дугаар (РД) ЗОРИУДААР БАЙХГҮЙ — нэвтрэлтгүй нийтийн
 * маягтаар иргэний үнэмлэхний мэдээлэл цуглуулахгүй.
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

  @Transform(emptyToNull)
  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender, { message: 'Хүйсээ сонгоно уу' })
  gender?: Gender | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional({ example: '1995-03-14', description: 'YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Төрсөн огноогоо оруулна уу' })
  birthDate?: string | null;

  @Transform(emptyToNull)
  @ApiPropertyOptional({ example: 'bataa@example.mn' })
  @IsOptional()
  @IsEmail({}, { message: 'И-мэйл хаяг буруу байна' })
  @MaxLength(160)
  email?: string | null;

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
