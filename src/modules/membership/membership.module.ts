import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { MemberModule } from '../member/member.module';
import { Member } from '../member/member.entity';
import { Package } from '../package/package.entity';
import { MembershipController } from './membership.controller';
import { Membership } from './membership.entity';
import { MembershipScheduler } from './membership.scheduler';
import { MembershipService } from './membership.service';
import { SyncJobsController } from './sync-jobs.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Membership, Member, Package]),
    LoyaltyModule,
    MemberModule,
  ],
  controllers: [MembershipController, SyncJobsController],
  providers: [MembershipService, MembershipScheduler],
  exports: [MembershipService],
})
export class MembershipModule {}
