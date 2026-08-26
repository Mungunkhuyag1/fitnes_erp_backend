import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@winfit.mn' })
  @IsEmail({}, { message: 'И-мэйл хаяг буруу байна' })
  @MaxLength(160)
  email: string;

  @ApiProperty({ example: 'нууц-үг' })
  @IsString()
  @MaxLength(200)
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  refreshToken: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Мөнгөнхуяг' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Нэр хэт богино байна' })
  @MaxLength(120)
  name?: string;

  /**
   * Профайл зураг — `data:image/...;base64,...` эсвэл хоосон (устгах).
   *
   * 200КБ хязгаар: клиент 128×128 болгож жижигрүүлдэг тул ~10КБ болох
   * ёстой. Хязгаарыг өгөөмөр тавьсан ч хязгааргүй байж БОЛОХГҮЙ — эс
   * бөгөөс хэн нэгэн санг зургаар дүүргэж чадна.
   */
  @ApiPropertyOptional({ description: 'data: URL, 200КБ хүртэл' })
  @IsOptional()
  @IsString()
  @MaxLength(200_000, { message: 'Зураг хэт том байна' })
  @Matches(/^$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, {
    message: 'Зөвхөн PNG, JPEG, WEBP зураг',
  })
  avatar?: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Одоогийн (эсвэл түр) нууц үг' })
  @IsString()
  @MaxLength(200)
  currentPassword: string;

  @ApiProperty({ minLength: 8, description: 'Шинэ нууц үг — хамгийн багадаа 8 тэмдэгт' })
  @IsString()
  @MinLength(8, { message: 'Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой' })
  @MaxLength(200)
  newPassword: string;
}
