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
import { MailModule } from '../mail/mail.module';
import { DeviceHealthService } from './device-health.service';
import { DeviceAuditService } from './device-audit.service';
import { DeviceConnectionService } from './device-connection.service';
import { DeviceDiagnosticsService } from './device-diagnostics.service';
import { DeviceImageService } from './device-image.service';
import { DeviceService } from './device.service';
import { DirectDeviceGateway } from './direct-device.gateway';
import { ReadOnlyDeviceGateway } from './read-only.gateway';
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
    MailModule,
  ],
  controllers: [DeviceController],
  providers: [
    DeviceAuditService,
    DeviceHealthService,
    DeviceConnectionService,
    DeviceDiagnosticsService,
    DeviceImageService,
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
        const mode = config.get<string>('gateways.device');
        const chosen =
          mode === 'direct'
            ? // Нэг LAN дотор — хөгжүүлэлт, газар дээрх туршилт.
              direct
            : mode === 'agent'
              ? // NAT-ын ард — on-prem agent WSS-ээр (B12b).
                agent
              : stub;

        /*
         * ⚠ БИЧИХ ХААЛТ. `DEVICE_WRITES=off` үед бүрхүүлээр ороож
         * бичих гурван үйлдлийг зогсооно. Унших ба хаалга нээх
         * ажилласаар байна.
         *
         * `stub` дээр хэрэглэхгүй: тэнд бичилт хаана ч хүрдэггүй тул
         * хааснаар зөвхөн хөгжүүлэлт төвөгтэй болно.
         */
        if (mode !== 'stub' && config.get<string>('gateways.deviceWrites') === 'off') {
          return new ReadOnlyDeviceGateway(chosen);
        }
        return chosen;
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
