import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { Member } from '../member/member.entity';
import { AccessService } from './access.service';
import { ListAccessEventsDto, SimulateAccessDto } from './dto/access.dto';

@ApiTags('access')
@ApiBearerAuth('access-token')
@Controller('access-events')
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly config: ConfigService,
    @InjectRepository(Member) private readonly members: Repository<Member>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Ирцийн бүртгэл (хуудаслалттай)' })
  list(@Query() q: ListAccessEventsDto) {
    return this.access.list(q);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Ирцийн товч үзүүлэлт' })
  @ApiQuery({ name: 'days', required: false })
  stats(@Query('days') days?: string) {
    if (days === undefined || days === '') return this.access.stats(null);
    const n = Number(days);
    return this.access.stats(Number.isFinite(n) && n >= 0 && n <= 365 ? n : 0);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Сүүлийн 50 нэвтрэлт — dashboard-ийн урсгал' })
  recent() {
    return this.access.recent();
  }

  /**
   * Хөгжүүлэлтийн туслах — терминалгүйгээр нэвтрэлт дуурайлгах.
   * Production-д ХААЛТТАЙ (docs/05-backend-api.md §9).
   */
  @Roles(Role.ADMIN)
  @Post('simulate')
  @ApiOperation({ summary: '[dev] Нэвтрэлт дуурайлгах' })
  async simulate(@Body() dto: SimulateAccessDto) {
    if (this.config.get<string>('env') === 'production') {
      throw new BadRequestException('Production дээр боломжгүй');
    }
    const member = await this.members.findOne({ where: { id: dto.memberId } });
    if (!member) throw new BadRequestException('Гишүүн олдсонгүй');

    const eventAt = new Date(Date.now() - (dto.minutesAgo ?? 0) * 60_000);
    const inserted = await this.access.ingest({
      employeeNo: member.memberNo,
      eventAt,
      verifyMode: 'face',
      raw: { simulated: true },
    });
    return { inserted, employeeNo: member.memberNo, eventAt };
  }
}
