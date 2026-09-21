import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';
import { AccessReason } from '../access-event.entity';

export class ListAccessEventsDto extends PageQueryDto {
  /**
   * Эрэмбэлэх багана — хүснэгтийн толгойн мөр дээрээс.
   *
   * ⚠ ЦАГААЖСАН ЖАГСААЛТ — энэ нь SQL түлхэлтийн хил. Утгыг шууд
   *   `ORDER BY`-д оруулдаг тул жагсаалтад байхгүй утгыг ХЭЗЭЭ Ч
   *   хүлээж авахгүй.
   */
  @ApiPropertyOptional({ enum: ['eventAt', 'memberNo', 'reason', 'verify'] })
  @IsOptional()
  @IsIn(['eventAt', 'memberNo', 'reason', 'verify'])
  sort?: string;

  @ApiPropertyOptional({ description: 'Гишүүний нэр эсвэл утсаар хайх' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  memberId?: string;

  /**
   * Терминал дээрх хэрэглэгчийн дугаараар шүүх.
   *
   * ★ ЯАГААД `memberId`-ЭЭС ТУСДАА ВЭ
   *
   * Терминалаас татсан ирц нь WinFit-д ГИШҮҮНГҮЙ байж болно — импорт
   * хийхээс өмнөх уншуулалт, эсвэл зөвхөн терминал дээр үүсгэсэн хүн.
   * Тэр үед `member_id` нь NULL боловч `employee_no` үлддэг. Гишүүний
   * ID-гаар шүүх нь эдгээрийг ОГТ олохгүй тул дугаараар шүүх хэрэгтэй.
   */
  /*
   * ⚠ ТЕКСТ. Терминал дээр дугаар нь текст байж болно (`Adiya`) тул
   * тоон шалгалт тавибал тэр хүнийг ОГТ хайж чадахгүй болно.
   */
  @ApiPropertyOptional({ example: '1001', description: 'Терминал дээрх дугаар' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  memberNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiPropertyOptional({ description: 'Зөвшөөрсөн / татгалзсан' })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : undefined,
  )
  @IsBoolean()
  granted?: boolean;

  @ApiPropertyOptional({ enum: AccessReason })
  @IsOptional()
  @IsEnum(AccessReason)
  reason?: AccessReason;

  /** Сүүлийн N хоног (серверийн цагаар). `0` = өнөөдөр. */
  @ApiPropertyOptional({ example: 7, minimum: 0, maximum: 3650 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  days?: number;

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

/** Зөвхөн хөгжүүлэлтэд — терминалын эвентийг дуурайлгах. */
export class SimulateAccessDto {
  @ApiProperty()
  @IsUUID()
  memberId: string;

  @ApiPropertyOptional({ default: 0, description: 'Хэдэн минутын өмнө болсон' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minutesAgo?: number;
}
