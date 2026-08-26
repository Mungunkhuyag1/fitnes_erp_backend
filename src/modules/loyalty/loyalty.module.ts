import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../member/member.entity';
import { Membership } from '../membership/membership.entity';
import { LoyaltyClient } from './loyalty.client';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltySyncService } from './loyalty-sync.service';
import { LoyaltyWebhookController } from './loyalty-webhook.controller';
import { ReconcileService } from './reconcile.service';
import { ReminderLog } from './reminder-log.entity';
import { ReminderService } from './reminder.service';

@Module({
  imports: [TypeOrmModule.forFeature([Member, Membership, ReminderLog])],
  controllers: [LoyaltyController, LoyaltyWebhookController],
  providers: [
    LoyaltyClient,
    LoyaltySyncService,
    ReminderService,
    ReconcileService,
  ],
  exports: [LoyaltyClient, ReminderService, ReconcileService],
})
export class LoyaltyModule {}
