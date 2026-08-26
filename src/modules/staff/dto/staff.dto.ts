import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

export class CreateStaffDto {
  @ApiProperty({ example: 'bataa@winfit.mn' })
  @IsEmail({}, { message: 'И-мэйл хаяг буруу байна' })
  @MaxLength(160)
  email: string;

  @ApiProperty({ example: 'Батаа' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: Role, example: Role.RECEPTION })
  @IsEnum(Role)
  role: Role;

  @ApiProperty({
    minLength: 8,
    description:
      'Түр нууц үг — ажилтанд амаар дамжуулна. Эхний нэвтрэлтэд солихыг албадана.',
  })
  @IsString()
  @MinLength(8, { message: 'Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой' })
  @MaxLength(200)
  password: string;
}

export class UpdateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ResetStaffPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой' })
  @MaxLength(200)
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'bataa@winfit.mn' })
  @IsEmail({}, { message: 'И-мэйл хаяг буруу байна' })
  @MaxLength(160)
  email: string;

  @ApiPropertyOptional({
    description: 'Админд үлдээх тэмдэглэл — жишээ нь холбоо барих утас',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
