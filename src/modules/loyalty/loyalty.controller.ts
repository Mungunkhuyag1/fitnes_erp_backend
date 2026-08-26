import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { Member } from '../member/member.entity';
import { OutboxService } from '../outbox/outbox.service';
import { LoyaltyClient } from './loyalty.client';
import { LOYALTY_TOPICS, loyaltyGroup } from './loyalty-sync.service';

@ApiTags('loyalty')
@ApiBearerAuth('access-token')
@Controller()
export class LoyaltyController {
  constructor(
    private readonly client: LoyaltyClient,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly outbox: OutboxService,
  ) {}

  @Roles(Role.ADMIN)
  @Get('loyalty/ping')
  @ApiOperation({ summary: 'Loopy холболтыг шалгах' })
  ping() {
    return this.client.ping();
  }

  @Post('members/:id/card/resync')
  @ApiOperation({
    summary: 'Гишүүний картыг дахин sync хийх (хугацаа + талбар)',
  })
  async resyncCard(@Param('id', ParseUUIDPipe) id: string) {
    const member = await this.members.findOne({ where: { id } });
    if (!member) throw new BadRequestException('Гишүүн олдсонгүй');
    if (!member.loopyCardSerial) {
      throw new BadRequestException('Гишүүн Wallet карт үүсгээгүй байна');
    }
    await this.outbox.enqueue([
      {
        topic: LOYALTY_TOPICS.EXTEND,
        payload: { memberId: id },
        groupKey: loyaltyGroup(id),
      },
      {
        topic: LOYALTY_TOPICS.FIELDS,
        payload: { memberId: id },
        groupKey: loyaltyGroup(id),
      },
    ]);
    return { ok: true };
  }
}
