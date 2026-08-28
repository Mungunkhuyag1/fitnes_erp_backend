import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MailEvent } from '../mail.entity';

export class CreateRecipientDto {
  @ApiProperty({ example: 'erhem@winfit.mn' })
  @IsEmail()
  @MaxLength(160)
  email: string;

  @ApiPropertyOptional({ example: 'Эрхэм' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiProperty({ enum: MailEvent, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(MailEvent, { each: true })
  events: MailEvent[];
}

export class UpdateRecipientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: MailEvent, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(MailEvent, { each: true })
  events?: MailEvent[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
