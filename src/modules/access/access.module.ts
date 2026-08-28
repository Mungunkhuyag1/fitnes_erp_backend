import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceModule } from '../device/device.module';
import { Member } from '../member/member.entity';
import { AccessController } from './access.controller';
import { AccessEvent } from './access-event.entity';
import { AccessService } from './access.service';
import { AcsEventPoller } from './acs-event-poller.service';
import { DeviceWebhookController } from './device-webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessEvent, Member]),
    // Нөөц татагч нь DEVICE_GATEWAY-ээр дамжина.
    DeviceModule,
  ],
  controllers: [AccessController, DeviceWebhookController],
  providers: [AccessService, AcsEventPoller],
  exports: [AccessService, AcsEventPoller],
})
export class AccessModule {}
