import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Member } from '../member/member.entity';
import { OutboxModule } from '../outbox/outbox.module';
import { AgentDeviceGateway } from './agent-device.gateway';
import { Device } from './device.entity';
import { DEVICE_GATEWAY } from './device.gateway';
import { DeviceController } from './device.controller';
import { DeviceReconcileService } from './device-reconcile.service';
import { DeviceAuditService } from './device-audit.service';
import { DeviceConnectionService } from './device-connection.service';
import { DeviceDiagnosticsService } from './device-diagnostics.service';
import { DeviceService } from './device.service';
import { DirectDeviceGateway } from './direct-device.gateway';
import { DeviceSyncService } from './device-sync.service';
import { FaceWatchService } from './face-watch.service';
import { StubDeviceGateway } from './stub-device.gateway';

/**
 * `DEVICE_GATEWAY` env-ээр stub / жинхэнэ agent-ыг сонгоно.
 * Бизнесийн код зөвхөн `DeviceGateway` интерфейсийг мэднэ.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Member, Device]),
    OutboxModule,
    AuditModule,
  ],
  controllers: [DeviceController],
  providers: [
    DeviceAuditService,
    DeviceConnectionService,
    DeviceDiagnosticsService,
    StubDeviceGateway,
    DirectDeviceGateway,
    AgentDeviceGateway,
    {
      provide: DEVICE_GATEWAY,
      inject: [
        ConfigService,
        StubDeviceGateway,
        DirectDeviceGateway,
        AgentDeviceGateway,
      ],
      useFactory: (
        config: ConfigService,
        stub: StubDeviceGateway,
        direct: DirectDeviceGateway,
        agent: AgentDeviceGateway,
      ) => {
        switch (config.get<string>('gateways.device')) {
          // Нэг LAN дотор — хөгжүүлэлт, газар дээрх туршилт.
          case 'direct':
            return direct;
          // NAT-ын ард — on-prem agent WSS-ээр (B12b).
          case 'agent':
            return agent;
          default:
            return stub;
        }
      },
    },
    DeviceSyncService,
    FaceWatchService,
    DeviceService,
    DeviceReconcileService,
  ],
  exports: [
    DEVICE_GATEWAY,
    FaceWatchService,
    StubDeviceGateway,
    DeviceService,
    DeviceReconcileService,
    DeviceAuditService,
  ],
})
export class DeviceModule {}
