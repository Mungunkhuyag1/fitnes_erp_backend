import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxController } from './outbox.controller';
import { OutboxMessage } from './outbox.entity';
import { OutboxRegistry } from './outbox.registry';
import { OutboxService } from './outbox.service';
import { OutboxSignal } from './outbox.signal';
import { OutboxWorker } from './outbox.worker';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxMessage])],
  controllers: [OutboxController],
  providers: [OutboxService, OutboxRegistry, OutboxSignal, OutboxWorker],
  exports: [OutboxService, OutboxRegistry],
})
export class OutboxModule {}
