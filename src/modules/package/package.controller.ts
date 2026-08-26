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
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CreatePackageDto,
  ListPackagesDto,
  UpdatePackageDto,
} from './dto/package.dto';
import { PackageService } from './package.service';

@ApiTags('packages')
@ApiBearerAuth('access-token')
@Controller('packages')
export class PackageController {
  constructor(private readonly packages: PackageService) {}

  @Get()
  @ApiOperation({ summary: 'Багцууд (хуудаслалттай)' })
  list(@Query() q: ListPackagesDto) {
    return this.packages.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Багцын мэдээлэл' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.packages.get(id);
  }

  @Roles(Role.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Багц үүсгэх' })
  create(@Body() dto: CreatePackageDto) {
    return this.packages.create(dto);
  }

  @Roles(Role.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Багц засах' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePackageDto) {
    return this.packages.update(id, dto);
  }

  @Roles(Role.MANAGER)
  @Delete(':id')
  @ApiOperation({ summary: 'Багц идэвхгүй болгох (устгахгүй)' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.packages.deactivate(id);
  }
}
