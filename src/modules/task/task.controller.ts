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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import { CompleteTaskDto, CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { TaskService } from './task.service';

/**
 * Төлөвлөгөөт ажил — ДОТООД хэрэгсэл.
 *
 * ★ ЭРХИЙН ХУВААРЬ
 *
 * Харах ба ГҮЙЦЭТГЭХ нь бүх ажилтанд: ресепшн өдөр тутмын ажлаа
 * тэмдэглэх ёстой. Харин ДҮРЭМ үүсгэх, засах, унтраах нь MANAGER-ээс
 * дээш: энэ нь бусдын ажлыг товлох үйлдэл.
 */
@ApiTags('tasks')
@ApiBearerAuth('access-token')
@Controller('tasks')
export class TaskController {
  constructor(
    private readonly tasks: TaskService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Календарийн өгөгдөл — заасан мужийн БҮХ тохиолдол.
   *
   * `mine=true` бол зөвхөн өөрийнх нь + эзэнгүй ажлууд.
   */
  @Get('occurrences')
  @ApiOperation({ summary: 'Мужийн тохиолдлууд (календарь)' })
  @ApiQuery({ name: 'from', example: '2026-09-01' })
  @ApiQuery({ name: 'to', example: '2026-09-30' })
  @ApiQuery({ name: 'mine', required: false, example: 'true' })
  occurrences(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('mine') mine: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.occurrences(from, to, mine === 'true' ? user.id : undefined);
  }

  /** Нүүр хуудасны жагсаалт — өнөөдөр + хоцорсон, гүйцэтгээгүй нь. */
  @Get('todo')
  @ApiOperation({ summary: 'Миний өнөөдрийн ажил' })
  todo(@CurrentUser() user: AuthUser) {
    return this.tasks.todo(user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Ажлын дүрмүүд' })
  @ApiQuery({ name: 'all', required: false, description: 'Унтраасныг ч оруулах' })
  list(@Query('all') all?: string) {
    return this.tasks.list(all === 'true');
  }

  @Roles(Role.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Ажил төлөвлөх' })
  async create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthUser) {
    const t = await this.tasks.create(dto, user.id);
    await this.audit.record({
      staffUserId: user.id,
      action: 'task.create',
      entity: 'task',
      entityId: t.id,
      after: { title: t.title, kind: t.kind, startsOn: t.startsOn },
    });
    return t;
  }

  @Roles(Role.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Ажлын дүрэм засах' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthUser,
  ) {
    const t = await this.tasks.update(id, dto);
    await this.audit.record({
      staffUserId: user.id,
      action: 'task.update',
      entity: 'task',
      entityId: id,
      after: { ...dto },
    });
    return t;
  }

  /**
   * ⚠ Мөрийг устгахгүй — УНТРААНА.
   *
   * Гүйцэтгэлийн бүртгэл нь `ON DELETE CASCADE` тул устгавал өнгөрсөн
   * түүх хамт арилна.
   */
  @Roles(Role.MANAGER)
  @Delete(':id')
  @ApiOperation({ summary: 'Ажлыг унтраах (устгахгүй)' })
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const r = await this.tasks.deactivate(id);
    await this.audit.record({
      staffUserId: user.id,
      action: 'task.deactivate',
      entity: 'task',
      entityId: id,
    });
    return r;
  }

  /** Гүйцэтгэсэн гэж тэмдэглэх — БҮХ ажилтан. */
  @Post(':id/complete')
  @ApiOperation({ summary: 'Тухайн өдрийн ажлыг гүйцэтгэсэн гэж тэмдэглэх' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CompleteTaskDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.complete(id, body.on, user.id);
  }

  @Delete(':id/complete')
  @ApiOperation({ summary: 'Тэмдэглэгээг буцаах' })
  @ApiQuery({ name: 'on', example: '2026-09-22' })
  uncomplete(@Param('id', ParseUUIDPipe) id: string, @Query('on') on: string) {
    return this.tasks.uncomplete(id, on);
  }
}
