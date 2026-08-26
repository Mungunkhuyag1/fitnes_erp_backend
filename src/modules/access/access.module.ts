import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../member/member.entity';
import { AccessController } from './access.controller';
import { AccessEvent } from './access-event.entity';
import { AccessService } from './access.service';

@Module({
  imports: [TypeOrmModule.forFeature([AccessEvent, Member])],
  controllers: [AccessController],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
