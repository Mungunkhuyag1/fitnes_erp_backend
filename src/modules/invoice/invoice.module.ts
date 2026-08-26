import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../member/member.entity';
import { MembershipModule } from '../membership/membership.module';
import { Package } from '../package/package.entity';
import { BonumService } from './bonum.service';
import { BonumWebhookController } from './bonum-webhook.controller';
import { IntegrationToken } from './integration-token.entity';
import { Invoice } from './invoice.entity';
import { InvoiceController } from './invoice.controller';
import { InvoiceScheduler } from './invoice.scheduler';
import { InvoiceService } from './invoice.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, IntegrationToken, Member, Package]),
    MembershipModule,
  ],
  controllers: [InvoiceController, BonumWebhookController],
  providers: [InvoiceService, BonumService, InvoiceScheduler],
  exports: [InvoiceService, BonumService],
})
export class InvoiceModule {}
