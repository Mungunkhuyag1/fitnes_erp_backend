import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromotionController } from './promotion.controller';
import { Promotion, PromotionRedemption } from './promotion.entity';
import { PromotionService } from './promotion.service';

@Module({
  imports: [TypeOrmModule.forFeature([Promotion, PromotionRedemption])],
  controllers: [PromotionController],
  providers: [PromotionService],
  exports: [PromotionService],
})
export class PromotionModule {}
