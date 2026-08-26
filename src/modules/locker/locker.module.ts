import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../member/member.entity';
import { LockerAssignment } from './locker-assignment.entity';
import { LockerController } from './locker.controller';
import { Locker } from './locker.entity';
import { LockerService } from './locker.service';

@Module({
  imports: [TypeOrmModule.forFeature([Locker, LockerAssignment, Member])],
  controllers: [LockerController],
  providers: [LockerService],
  exports: [LockerService],
})
export class LockerModule {}
