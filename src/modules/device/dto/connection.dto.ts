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
  /**
   * IP хаяг ЭСВЭЛ домэйн нэр.
   *
   * ⚠ Урьд нь зөвхөн IPv4 зөвшөөрдөг байв. Терминал NAT-ын ард
   * байдаг тул үүлэн backend нь дотоод IP руу хүрэх БОЛОМЖГҮЙ —
   * туннель (`xxx.trycloudflare.com`) эсвэл agent-ийн хаягаар
   * холбогдоно. Тэдгээр нь домэйн нэр тул хуучин шалгалт
   * газар дээрх цорын ганц ажиллах хувилбарыг хаадаг байлаа.
   *
   * Хоосон илгээвэл `null` бичигдэж, `HIK_HOST` орчны хувьсагч
   * идэвхжинэ.
   */
  @ApiPropertyOptional({ example: '192.168.0.106' })
  @IsOptional()
  @Matches(
    /^(?:\d{1,3}(?:\.\d{1,3}){3}|(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)$/,
    {
      message:
        'IP хаяг эсвэл домэйн нэр буруу байна ' +
        '(жиш. 192.168.0.106 эсвэл hik.winfit.mn)',
    },
  )
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
