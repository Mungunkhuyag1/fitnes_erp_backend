import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import { ConnectPageDto, LinkMemberDto, SendMessageDto } from './dto/meta.dto';
import { MetaService } from './meta.service';

/**
 * Facebook Page-ийн хайрцаг.
 *
 * ★ ЭРХ
 *
 * Унших ба ХАРИУЛАХ нь БҮХ ажилтанд — ресепшн чатад хариулна.
 * Харин ХОЛБОЛТЫН тохиргоо нь ADMIN: токен нь хуудсын нэрийн өмнөөс
 * бичих эрх олгодог.
 */
@ApiTags('meta')
@ApiBearerAuth('access-token')
@Controller('meta')
export class MetaController {
  constructor(
    private readonly meta: MetaService,
    private readonly audit: AuditService,
  ) {}

  // ── Холболт ──

  @Get('status')
  @ApiOperation({ summary: 'Холболтын төлөв (нууц утга буцаахгүй)' })
  status() {
    return this.meta.status();
  }

  @Roles(Role.ADMIN)
  @Post('connect')
  @ApiOperation({ summary: 'Facebook хуудас холбох' })
  async connect(@Body() dto: ConnectPageDto, @CurrentUser() user: AuthUser) {
    const r = await this.meta.connect(dto, user.id);
    await this.audit.record({
      staffUserId: user.id,
      action: 'meta.connect',
      entity: 'meta_page',
      entityId: r.pageId,
      after: { pageName: r.pageName },
    });
    return r;
  }

  @Roles(Role.ADMIN)
  @Delete('connect')
  @ApiOperation({ summary: 'Холболтыг салгах' })
  async disconnect(@CurrentUser() user: AuthUser) {
    const r = await this.meta.disconnect();
    await this.audit.record({
      staffUserId: user.id,
      action: 'meta.disconnect',
      entity: 'meta_page',
    });
    return r;
  }

  // ── Хайрцаг ──

  @Get('conversations')
  @ApiOperation({ summary: 'Яриануудын жагсаалт' })
  list(@Query('limit') limit?: string) {
    return this.meta.list(limit ? Number(limit) : 50);
  }

  /** Хажуугийн цэсний тэмдэгт — хөнгөн дуудлага. */
  @Get('unread')
  @ApiOperation({ summary: 'Уншаагүй мессежийн нийт тоо' })
  unread() {
    return this.meta.unreadCount();
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Ярианы бүтэн түүх' })
  thread(@Param('id', ParseUUIDPipe) id: string) {
    return this.meta.thread(id);
  }

  @Post('conversations/:id/read')
  @ApiOperation({ summary: 'Уншсан гэж тэмдэглэх' })
  read(@Param('id', ParseUUIDPipe) id: string) {
    return this.meta.markRead(id);
  }

  @Post('conversations/:id/send')
  @ApiOperation({ summary: 'Хариу илгээх' })
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meta.send(id, dto.text, user.id);
  }

  /**
   * Гишүүнтэй холбох.
   *
   * ⚠ Messenger утасны дугаар өгдөггүй тул автоматаар таних арга
   * байхгүй — ажилтан нэг удаа гараар холбоно.
   */
  @Patch('conversations/:id/member')
  @ApiOperation({ summary: 'Яриаг гишүүнтэй холбох / салгах' })
  async link(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkMemberDto,
    @CurrentUser() user: AuthUser,
  ) {
    const r = await this.meta.linkMember(id, dto.memberId ?? null);
    await this.audit.record({
      staffUserId: user.id,
      action: 'meta.linkMember',
      entity: 'meta_conversation',
      entityId: id,
      after: { memberId: dto.memberId ?? null },
    });
    return r;
  }
}
