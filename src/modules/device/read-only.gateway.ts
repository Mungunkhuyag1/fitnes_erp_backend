import { Logger } from '@nestjs/common';
import { PermanentError } from '../outbox/outbox.errors';
import type {
  DeviceGateway,
  DeviceInfo,
  DeviceUserRow,
  SetValidityInput,
  UpsertUserInput,
  FaceInfo,
} from './device.gateway';

/**
 * Терминал руу БИЧИХИЙГ хаах бүрхүүл (`DEVICE_WRITES=off`).
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * `DEVICE_GATEWAY=direct` болмогц outbox нь өөрөө бичиж эхэлдэг —
 * гишүүн үүсгэх, засах бүрт `hik.userUpsert` үүсээд 15 секунд тутам
 * түлхэнэ. Эхлээд «зөвхөн харах» горимоор ажиллуулъя гэвэл түүнийг
 * зогсоох арга байгаагүй: «бичихгүй» гэдэг нь АМЛАЛТ байсан.
 *
 * Энэ бүрхүүл түүнийг ТЕХНИКИЙН БАТАЛГАА болгоно.
 *
 * ★ ЯАГААД ЭНД БАРИВ (handler бүрт биш)
 *
 * Бичих гарц дөрөв биш: outbox handler, шөнийн тулгалт, гараар синк,
 * тулгалтын мөр бүрийн «түлхэх/устгах» товч. Handler бүрт шалгалт
 * тавибал нэгийг нь мартах нь цаг хугацааны асуудал. Gateway нь
 * БҮГДИЙН доогуур өнгөрдөг ганц цэг.
 *
 * ★ ЗӨВШӨӨРӨГДӨХ зүйлс
 *
 * Унших (`listUsers`, `info`, `faceStatus`, `fetchEvents`) ба
 * `openDoor`. Хаалга нээх нь өгөгдөл БИЧИХГҮЙ — ресепшн хүнийг
 * оруулах үйлдэл.
 *
 * ★ ХААСАН ажил яах вэ
 *
 * `PermanentError` шиднэ → outbox дахин оролдохгүй, шууд `failed`
 * болно (дахин оролдлогын шуурга үүсэхгүй). `DeviceSyncService.handle`
 * нь гишүүн дээр `hik_sync_error` тэмдэглэнэ. Хожим бичилтийг нээхэд
 * шөнийн тулгалт тэдгээр гишүүнийг ӨӨРӨӨ дахин дараалалд оруулна —
 * өөрөөр хэлбэл хоцорсон бичилт алдагдахгүй.
 */
export class ReadOnlyDeviceGateway implements DeviceGateway {
  private readonly log = new Logger(ReadOnlyDeviceGateway.name);

  constructor(private readonly inner: DeviceGateway) {}

  private blocked(what: string): never {
    this.log.warn(
      `DEVICE_WRITES=off — «${what}» хийгдсэнгүй. ` +
        'Бичилт нээхийн өмнө тулгалтыг (Тулгаж засах) шалгаарай.',
    );
    throw new PermanentError(
      `Терминал руу бичих хаалттай (DEVICE_WRITES=off): ${what}`,
    );
  }

  // ── Хаасан ──
  upsertUser(input: UpsertUserInput): Promise<void> {
    this.blocked(`хэрэглэгч бичих №${input.employeeNo}`);
  }
  setValidity(input: SetValidityInput): Promise<void> {
    this.blocked(`хугацаа өөрчлөх №${input.employeeNo}`);
  }

  // ── Зөвшөөрсөн ──
  faceStatus(employeeNos: number[]): Promise<Record<number, FaceInfo>> {
    return this.inner.faceStatus(employeeNos);
  }
  listUsers(): Promise<DeviceUserRow[]> {
    return this.inner.listUsers();
  }
  openDoor(doorNo?: number): Promise<void> {
    return this.inner.openDoor(doorNo);
  }
  info(): Promise<DeviceInfo> {
    return this.inner.info();
  }
  fetchEvents(...args: Parameters<DeviceGateway['fetchEvents']>) {
    return this.inner.fetchEvents(...args);
  }
}
