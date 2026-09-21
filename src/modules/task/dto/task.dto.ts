import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { TaskKind } from '../task.entity';

/**
 * ⚠ ОГНООГ `@IsDate`-ЭЭР ШАЛГАХГҮЙ.
 *
 * `@Type(() => Date)` нь `2026-09-22`-ыг UTC шөнө дунд болгож хөрвүүлдэг
 * ба заалны цагаар (UTC+8) тэр нь 08:00 болно. Буцааж бичихэд өдөр нь
 * гулсах эрсдэлтэй. Хуанлийн өдөр нь цаг бүсгүй тул ТЕКСТЭЭР дамжуулж,
 * хэлбэрийг нь л шалгана.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateTaskDto {
  @ApiProperty({ example: 'Шүүгээний түлхүүр тоолох' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ enum: TaskKind, example: TaskKind.DAILY })
  @IsEnum(TaskKind)
  kind: TaskKind;

  @ApiProperty({ example: '2026-09-22', description: 'YYYY-MM-DD' })
  @Matches(DAY, { message: 'startsOn нь YYYY-MM-DD хэлбэртэй байна' })
  startsOn: string;

  @ApiPropertyOptional({ example: '08:30', description: 'HH:MM' })
  @IsOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== null && v !== '')
  @Matches(TIME, { message: 'atTime нь HH:MM хэлбэртэй байна' })
  atTime?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== null && v !== '')
  @Matches(DAY, { message: 'endsOn нь YYYY-MM-DD хэлбэртэй байна' })
  endsOn?: string | null;

  /** `null` = хэн ч — бүх ажилтны жагсаалтад харагдана. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== null && v !== '')
  @IsUUID()
  assigneeId?: string | null;
}

/**
 * Бүх талбар заавал биш — нүүр хуудасны МӨРӨН ДЭЭРХ засвар нь зөвхөн
 * `title`-ыг илгээдэг.
 */
export class UpdateTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ enum: TaskKind })
  @IsOptional()
  @IsEnum(TaskKind)
  kind?: TaskKind;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DAY)
  startsOn?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== null && v !== '')
  @Matches(TIME)
  atTime?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== null && v !== '')
  @Matches(DAY)
  endsOn?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== null && v !== '')
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * «Гүйцэтгэсэн» тэмдэглэгээний бие.
 *
 * ⚠ ЗААВАЛ КЛАСС БАЙХ ЁСТОЙ. `@Body() body: { on: string }` гэж бичвэл
 * ValidationPipe нь `whitelist: true, forbidNonWhitelisted: true`
 * тохиргоотой тул цагаажсан талбар БАЙХГҮЙ гэж үзэж `on`-ыг хаяна —
 * бүх дарлага 400 өгнө. TypeScript үүнийг барьж чадахгүй.
 */
export class CompleteTaskDto {
  @ApiProperty({ example: '2026-09-22', description: 'YYYY-MM-DD' })
  @Matches(DAY, { message: 'on нь YYYY-MM-DD хэлбэртэй байна' })
  on: string;
}
