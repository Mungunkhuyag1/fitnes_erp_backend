import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Member } from '../member/member.entity';
import { MembershipModule } from '../membership/membership.module';
import { SettingsModule } from '../settings/settings.module';
import { FreezeController } from './freeze.controller';
import { Freeze, FreezeApplication } from './freeze.entity';
import { FreezeService } from './freeze.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Freeze, FreezeApplication, Member]),
    MembershipModule,
    SettingsModule,
    AuditModule,
  ],
  controllers: [FreezeController],
  providers: [FreezeService],
  exports: [FreezeService],
})
export class FreezeModule {}
