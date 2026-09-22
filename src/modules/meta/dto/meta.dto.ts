import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Facebook хуудас холбох.
 *
 * ⚠ Токен ба app secret нь НУУЦ — санд битүүмжлэгдэж хадгалагдана,
 * хариуд хэзээ ч буцаагдахгүй.
 */
export class ConnectPageDto {
  /**
   * Заавал биш — токен өөрөө аль хуудсынх болохыг хэлнэ.
   *
   * Өгвөл таарах эсэхийг шалгана — буруу токен буулгасан эсэхийг
   * барихад. Өгөөгүй бол токеныхыг авна: Page ID-г олох нь
   * Meta-гийн самбарт үргэлж амархан байдаггүй.
   */
  @ApiPropertyOptional({ example: '102938475610293', description: 'Facebook Page ID' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(40)
  pageId?: string;

  @ApiProperty({ description: 'Page access token (урт хугацааных)' })
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  token: string;

  @ApiProperty({ description: 'App secret — түлхэлтийн гарын үсэг шалгахад' })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  appSecret: string;

  /**
   * Meta-гийн хяналтын самбарт бичих баталгаажуулалтын үг.
   * НУУЦ БИШ — зөвхөн «энэ хаяг минийх» гэдгийг батална.
   */
  @ApiProperty({ example: 'winfit-2026' })
  @IsString()
  @MinLength(6)
  @MaxLength(120)
  verifyToken: string;
}

export class SendMessageDto {
  @ApiProperty({ example: 'Сайн байна уу! Багцын үнэ...' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text: string;
}

export class LinkMemberDto {
  @ApiPropertyOptional({ nullable: true, description: 'Салгахад null' })
  @IsOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== null)
  @IsUUID()
  memberId?: string | null;
}
