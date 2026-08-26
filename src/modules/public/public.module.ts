import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceModule } from '../invoice/invoice.module';
import { Member } from '../member/member.entity';
import { Package } from '../package/package.entity';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [TypeOrmModule.forFeature([Member, Package]), InvoiceModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
