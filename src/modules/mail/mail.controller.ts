import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CreateRecipientDto,
  UpdateRecipientDto,
} from './dto/mail.dto';
import { DigestService } from './digest.service';
import { MailRecipientService } from './recipient.service';

@ApiTags('mail')
@ApiBearerAuth('access-token')
@Roles(Role.ADMIN)
@Controller('mail')
export class MailController {
  constructor(
    private readonly recipients: MailRecipientService,
    private readonly digest: DigestService,
  ) {}

  @Get('recipients')
  @ApiOperation({ summary: 'Мэдэгдэл хүлээн авагчид' })
  list() {
    return this.recipients.list();
  }

  @Post('recipients')
  @ApiOperation({ summary: 'Хүлээн авагч нэмэх' })
  create(@Body() dto: CreateRecipientDto) {
    return this.recipients.create(dto);
  }

  @Patch('recipients/:id')
  @ApiOperation({ summary: 'Хүлээн авагч засах' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecipientDto,
  ) {
    return this.recipients.update(id, dto);
  }

  @Delete('recipients/:id')
  @ApiOperation({ summary: 'Хүлээн авагч устгах' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.recipients.remove(id);
  }

  /** Тохиргоо зөв эсэхийг шалгах — нэг хаяг руу шууд илгээнэ. */
  @Post('test')
  @ApiOperation({ summary: 'Туршилтын мэйл илгээх' })
  test(@Body() body: { email?: string }) {
    return this.recipients.sendTest(body.email);
  }

  /** Өнөөдрийн тоо — мэйл илгээхгүйгээр харах. */
  @Get('digest/preview')
  @ApiOperation({ summary: 'Өдрийн хураангуйн тоо' })
  preview() {
    return this.digest.collect();
  }

  @Post('digest/run')
  @ApiOperation({ summary: 'Өдрийн хураангуйг ГАРААР илгээх' })
  async runDigest() {
    return { sent: await this.digest.run() };
  }

  @Get('log')
  @ApiOperation({ summary: 'Илгээсэн мэйлийн бүртгэл' })
  log() {
    return this.recipients.recentLog();
  }
}
