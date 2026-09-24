import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** `YYYY-MM-DD` — цаггүй огноо. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** `HH:MM` эсвэл `HH:MM:SS`. */
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

export class CreateYogaCourseDto {
  @ApiProperty({ example: 'Хатха йог — оройн анги' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Сараа багш' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  instructor?: string;

  @ApiProperty({ example: '2026-09-25' })
  @Matches(DAY, { message: 'starts_on нь YYYY-MM-DD байх ёстой' })
  startsOn: string;

  @ApiProperty({ example: '2026-10-25' })
  @Matches(DAY, { message: 'ends_on нь YYYY-MM-DD байх ёстой' })
  endsOn: string;

  /**
   * Долоо хоногийн аль өдрүүд. 0 = Ням … 6 = Бямба.
   *
   * ⚠ ЗААВАЛ нэгийг сонгоно. Хоосон орхивол ямар ч оролт үүсэхгүй
   * бөгөөд ажилтан «анги үүссэн» гэж бодоод хоосон хуваарьтай үлдэнэ.
   */
  @ApiProperty({ example: [1, 3, 5], description: '0=Ням … 6=Бямба' })
  @IsArray()
  @ArrayNotEmpty({ message: 'Долоо хоногийн өдрөө сонгоно уу' })
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays: number[];

  @ApiPropertyOptional({ example: '19:00' })
  @IsOptional()
  @Matches(TIME, { message: 'Цаг нь HH:MM байх ёстой' })
  startTime?: string;

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
  @Max(500)
  capacity?: number;

  @ApiPropertyOptional({ example: 250000, description: 'Ангийн үнэ (₮)' })
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
}

export class UpdateYogaCourseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  instructor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DAY)
  startsOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DAY)
  endsOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TIME)
  startTime?: string;

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
  @Max(500)
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

  /** `true` → архивлах (жагсаалтаас нуух). Устгахгүй. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ListYogaCoursesDto {
  @ApiPropertyOptional({ description: 'Нэр, багшаар хайх' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    enum: ['upcoming', 'active', 'finished'],
    description: 'Хуваарийн төлөв',
  })
  @IsOptional()
  @IsIn(['upcoming', 'active', 'finished'])
  state?: 'upcoming' | 'active' | 'finished';

  /** Архивласныг ч харуулах уу. Анхдагчаар ҮГҮЙ. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;
}

export class CreateYogaEnrollmentDto {
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

  @ApiPropertyOptional({ example: 'Дорж Бат', description: 'Гишүүн биш бол ЗААВАЛ' })
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

  /** Төлөх ёстой дүн. Өгөхгүй бол ангийн үнэ. */
  @ApiPropertyOptional({ example: 250000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountDue?: number;

  /**
   * Бүртгэх үед ХҮЛЭЭН АВСАН дүн.
   *
   * Төлөх ёстойгоос бага бол ҮЛДЭГДЭЛ үүснэ. Тэглэвэл бүрэн авлага.
   */
  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountPaid?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateYogaEnrollmentDto {
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
  amountDue?: number;

  /** Нийт хүлээн авсан дүнг ОРЛУУЛНА (нэмэхгүй). */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountPaid?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AddPaymentDto {
  /** Одоо хүлээн авсан дүн — НЭМЭГДЭНЭ. */
  @ApiProperty({ example: 50000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;
}

export class MarkAttendanceDto {
  @ApiProperty()
  @IsUUID()
  enrollmentId: string;

  @ApiProperty({ example: '2026-09-25' })
  @Matches(DAY, { message: 'Огноо нь YYYY-MM-DD байх ёстой' })
  sessionOn: string;

  /**
   * Ирц бүртгэхэд хаалгыг НЭЭХ үү.
   *
   * ⚠ Анхдагчаар ТИЙМ: ресепшн ирцийг яг хаалган дээр бүртгэдэг.
   * Терминал холбогдоогүй ч ирц нь бүртгэгдэнэ — хаалга нээгдсэн
   * эсэхийг хариунд тусад нь хэлнэ.
   */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  openDoor?: boolean;
}
