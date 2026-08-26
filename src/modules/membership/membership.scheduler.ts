import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { Member } from '../member/member.entity';

/**
 * Хугацаа дууссан гишүүдийг тэмдэглэнэ.
 *
 * ⚠ Энэ нь нэвтрэх эрхийг хаадаггүй — терминал өөрөө `Valid.endTime`-аар
 * шийддэг тул хугацаа дуусмагц LOCAL-аар хаагдана. Энд зөвхөн үүлэн талын
 * `status`-ыг бодит байдалд нийцүүлж, тайлан/жагсаалт зөв харагдана.
 */
@Injectable()
export class MembershipScheduler {
  private readonly log = new Logger(MembershipScheduler.name);

  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly config: ConfigService,
  ) {}

  @Cron('5 0 * * *', {
    name: 'expire-memberships',
    timeZone: 'Asia/Ulaanbaatar',
  })
  async expire(): Promise<number> {
    const res = await this.members.update(
      { status: MemberStatus.ACTIVE, accessEndsAt: LessThan(new Date()) },
      { status: MemberStatus.EXPIRED },
    );
    const n = res.affected ?? 0;
    if (n) this.log.log(`Хугацаа дууссан: ${n} гишүүн`);
    return n;
  }
}
