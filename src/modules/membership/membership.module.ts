import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { MemberModule } from '../member/member.module';
import { Member } from '../member/member.entity';
import { Package } from '../package/package.entity';
import { MailModule } from '../mail/mail.module';
import { MembershipController } from './membership.controller';
import { Membership } from './membership.entity';
import { MembershipScheduler } from './membership.scheduler';
import { MembershipService } from './membership.service';
import { SyncJobsController } from './sync-jobs.controller';

@Module({
  imports: [
    // Ирц татах товч `AcsEventPoller`-ээр дамжина.
    AccessModule,
    TypeOrmModule.forFeature([Membership, Member, Package]),
    LoyaltyModule,
    MailModule,
    MemberModule,
  ],
  controllers: [MembershipController, SyncJobsController],
  providers: [MembershipService, MembershipScheduler],
  exports: [MembershipService],
})
export class MembershipModule {}
