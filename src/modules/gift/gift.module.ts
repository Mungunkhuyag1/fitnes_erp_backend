import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { GiftController } from './gift.controller';
import { GiftCard } from './gift.entity';
import { GiftService } from './gift.service';

@Module({
  imports: [TypeOrmModule.forFeature([GiftCard]), LoyaltyModule, AuditModule],
  controllers: [GiftController],
  providers: [GiftService],
})
export class GiftModule {}
