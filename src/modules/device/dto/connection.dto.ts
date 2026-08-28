import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Терминалын холболтын тохиргоо.
 *
 * Талбар БҮР сонголттой: дэлгэцээс зөвхөн солигдсоныг нь илгээнэ.
 * Илгээгээгүй талбар хэвээрээ үлдэнэ.
 */
export class UpdateConnectionDto {
  @ApiPropertyOptional({ example: '192.168.0.106' })
  @IsOptional()
  @Matches(/^\d{1,3}(\.\d{1,3}){3}$/, {
    message: 'IP хаяг буруу байна (жиш. 192.168.0.106)',
  })
  ip?: string;

  @ApiPropertyOptional({ example: 80, description: 'ISAPI порт — 8000 нь SDK-ынх' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ApiPropertyOptional({ example: 'admin' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  user?: string;

  /** Хоосон илгээвэл хуучин нууц үг ХЭВЭЭР үлдэнэ. */
  @ApiPropertyOptional({ description: 'Хоосон бол хуучнаараа үлдэнэ' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  password?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  https?: boolean;
}
