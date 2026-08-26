import {
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { ListOutboxDto } from './dto/outbox.dto';
import { OutboxRegistry } from './outbox.registry';
import { OutboxService } from './outbox.service';

/**
 * Синкийн хяналт. B10-д бүрэн `/sync` дэлгэц болж өргөжинө.
 */
@ApiTags('sync')
@ApiBearerAuth('access-token')
@Roles(Role.MANAGER)
@Controller('sync')
export class OutboxController {
  constructor(
    private readonly outbox: OutboxService,
    private readonly registry: OutboxRegistry,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Дарааллын товч төлөв' })
  async status() {
    return {
      outbox: await this.outbox.stats(),
      topics: this.registry.topics(),
    };
  }

  @Get('outbox')
  @ApiOperation({ summary: 'Дарааллын мессежүүд (хуудаслалттай)' })
  list(@Query() q: ListOutboxDto) {
    return this.outbox.list(q);
  }

  @Post('outbox/:id/retry')
  @ApiOperation({ summary: 'Гараар дахин илгээх' })
  async retry(@Param('id') id: string) {
    await this.outbox.retry(id);
    return { ok: true };
  }
}
