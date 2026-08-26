import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from './audit.service';
import { ListAuditDto } from './dto/audit.dto';

@ApiTags('audit')
@ApiBearerAuth('access-token')
@Roles(Role.MANAGER)
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Аудит лог (хуудаслалттай)' })
  list(@Query() q: ListAuditDto) {
    return this.audit.list(q);
  }
}
