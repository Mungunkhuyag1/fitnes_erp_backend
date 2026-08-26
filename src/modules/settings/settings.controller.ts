import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import { UpdateSettingsDto } from './dto/settings.dto';
import { SettingsService, type SettingKey } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth('access-token')
@Roles(Role.ADMIN)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Бүх тохиргоо (анхдагч + хадгалагдсан)' })
  all() {
    return this.settings.all();
  }

  @Patch()
  @ApiOperation({ summary: 'Тохиргоо өөрчлөх' })
  async update(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const before = await this.settings.all();
    const entries = Object.entries(dto).filter(([, v]) => v !== undefined);
    for (const [key, value] of entries) {
      await this.settings.set(key as SettingKey, value as never);
    }
    if (entries.length) {
      await this.audit.record({
        staffUserId: user.id,
        action: 'settings.update',
        entity: 'settings',
        entityId: null,
        before: Object.fromEntries(entries.map(([k]) => [k, before[k]])),
        after: Object.fromEntries(entries),
        ip: req.ip ?? null,
      });
    }
    return this.settings.all();
  }
}
