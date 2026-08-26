import {
  Body,
  Controller,
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
import { CreateMemberDto, ListMembersDto, UpdateMemberDto } from './dto/member.dto';
import { MemberService } from './member.service';

@ApiTags('members')
@ApiBearerAuth('access-token')
@Controller('members')
export class MemberController {
  constructor(private readonly members: MemberService) {}

  @Get()
  @ApiOperation({
    summary: 'Гишүүд — хайлт, шүүлтүүр, хуудаслалт',
    description:
      'q (нэр/утас), status, expiring=N, faceEnrolled, hasCard, syncError, sort, page, limit',
  })
  list(@Query() q: ListMembersDto) {
    return this.members.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Гишүүний дэлгэрэнгүй' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.detail(id);
  }

  @Post()
  @ApiOperation({ summary: 'Гишүүн бүртгэх' })
  create(@Body() dto: CreateMemberDto) {
    return this.members.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Гишүүний мэдээлэл засах' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return this.members.update(id, dto);
  }

  @Post(':id/resync')
  @ApiOperation({ summary: 'Терминал руу дахин бичих (синк алдааны дараа)' })
  resync(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.resync(id);
  }

  @Roles(Role.MANAGER)
  @Post(':id/pay-token/rotate')
  @ApiOperation({ summary: 'Төлбөрийн холбоосыг сэлгэх' })
  rotatePayToken(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.rotatePayToken(id);
  }
}
