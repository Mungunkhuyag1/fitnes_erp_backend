import { Injectable } from '@nestjs/common';
import type {
  DeviceGateway,
  DeviceInfo,
  SetValidityInput,
  UpsertUserInput,
} from './device.gateway';

/**
 * Жинхэнэ терминал — on-prem agent руу WSS-ээр команд илгээж, `ack` хүлээнэ.
 *
 * B12-д хэрэгжинэ (docs/04-agent-design.md). Одоохондоо `DEVICE_GATEWAY=agent`
 * гэж тохируулбал ил тодоор унана — чимээгүй юу ч хийхгүй байхаас дээр.
 */
@Injectable()
export class AgentDeviceGateway implements DeviceGateway {
  private notReady(): never {
    throw new Error(
      'AgentDeviceGateway хараахан хэрэгжээгүй (B12). ' +
        'Хөгжүүлэлтэд DEVICE_GATEWAY=stub ашиглана уу.',
    );
  }

  upsertUser(_input: UpsertUserInput): Promise<void> {
    this.notReady();
  }
  setValidity(_input: SetValidityInput): Promise<void> {
    this.notReady();
  }
  deleteUser(_employeeNo: number): Promise<void> {
    this.notReady();
  }
  faceStatus(_employeeNos: number[]): Promise<Record<number, boolean>> {
    this.notReady();
  }
  openDoor(_doorNo?: number): Promise<void> {
    this.notReady();
  }
  info(): Promise<DeviceInfo> {
    this.notReady();
  }

  fetchEvents(): Promise<Record<string, unknown>[]> {
    this.notReady();
  }
}
