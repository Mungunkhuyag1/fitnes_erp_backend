import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { Member } from '../member/member.entity';
import { PermanentError } from '../outbox/outbox.errors';
import { OutboxRegistry } from '../outbox/outbox.registry';
import {
  DEVICE_GATEWAY,
  MissingDeviceUserError,
  type DeviceGateway,
} from './device.gateway';

/** Outbox topic-ууд — терминал руу чиглэсэн. */
export const DEVICE_TOPICS = {
  USER_UPSERT: 'hik.userUpsert',
  SET_VALIDITY: 'hik.setValidity',
  USER_DELETE: 'hik.userDelete',
} as const;

/** Гишүүн бүрийн командыг дараалалд барих түлхүүр. */
export const memberGroup = (memberId: string): string => `member:${memberId}`;

@Injectable()
export class DeviceSyncService implements OnModuleInit {
  private readonly log = new Logger(DeviceSyncService.name);

  constructor(
    @Inject(DEVICE_GATEWAY) private readonly device: DeviceGateway,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly registry: OutboxRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(DEVICE_TOPICS.USER_UPSERT, (p) =>
      this.handle(p, (m) =>
        this.device.upsertUser({
          employeeNo: m.memberNo,
          name: m.name,
          ...this.validity(m),
        }),
      ),
    );

    this.registry.register(DEVICE_TOPICS.SET_VALIDITY, (p) =>
      this.handle(p, async (m) => {
        try {
          await this.device.setValidity({
            employeeNo: m.memberNo,
            ...this.validity(m),
          });
        } catch (e) {
          if (!(e instanceof MissingDeviceUserError)) throw e;
          // ★ Өөрөө эдгэрэх: терминал дээр хэрэглэгч байхгүй бол (reset,
          // гараар устгасан, шинэ төхөөрөмж) БҮТЭН бичилт хийж нөхнө.
          // Царайг дахин уншуулах шаардлагатай — `face_enrolled` тэглэнэ.
          this.log.warn(
            `№${m.memberNo} терминал дээр байхгүй — бүтнээр дахин бичив`,
          );
          await this.device.upsertUser({
            employeeNo: m.memberNo,
            name: m.name,
            ...this.validity(m),
          });
          await this.members.update(m.id, {
            faceEnrolled: false,
            faceEnrolledAt: null,
          });
        }
      }),
    );

    this.registry.register(DEVICE_TOPICS.USER_DELETE, (p) =>
      this.handle(p, (m) => this.device.deleteUser(m.memberNo)),
    );
  }

  /**
   * Бүх handler-ийн нийтлэг бүрхүүл.
   *
   * Гол шийдвэр: payload нь ЗӨВХӨН `memberId` агуулна, командын агуулгыг
   * боловсруулах агшинд DB-ээс уншина. Иймд:
   *   • Мессеж хоцорсон ч терминал дээр ОДООГИЙН зөв төлөв бичигдэнэ
   *   • Дараалалд 3 мессеж хуримтлагдвал гурвуулаа ижил үр дүнд хүрнэ (идемпотент)
   */
  private async handle(
    payload: Record<string, unknown>,
    action: (m: Member) => Promise<void>,
  ): Promise<void> {
    const memberId = payload.memberId as string | undefined;
    if (!memberId) throw new PermanentError('payload-д memberId алга');

    const member = await this.members.findOne({ where: { id: memberId } });
    if (!member) {
      throw new PermanentError(`Гишүүн олдсонгүй: ${memberId}`);
    }

    try {
      await action(member);
      await this.members.update(member.id, {
        hikSyncedAt: new Date(),
        hikSyncError: null,
      });
    } catch (e) {
      // Алдааг гишүүн дээр тэмдэглэнэ — dashboard дээр «синк алдаа» гэж
      // харагдана. Дараа нь outbox өөрөө retry/failed-ыг шийднэ.
      await this.members.update(member.id, {
        hikSyncError: (e as Error).message.slice(0, 500),
      });
      throw e;
    }
  }

  /**
   * Терминал дээр бичих эрхийн цонх.
   *
   * `accessEndsAt` байхгүй (шинэ гишүүн, төлбөр хийгээгүй) бол эхлэл=төгсгөл
   * гэсэн ХООСОН цонх — хэрэглэгч төхөөрөмж дээр үүснэ (царайгаа бүртгүүлж
   * чадна) ч нэвтрэх эрхгүй.
   *
   * ⚠ B12-д жинхэнэ төхөөрөмж дээр баталгаажуулах: зарим firmware `end <= begin`
   * цонхыг татгалзаж болзошгүй. Тэр тохиолдолд `enable=false` рүү шилжинэ.
   */
  private validity(m: Member): { begin: Date; end: Date; enable: boolean } {
    const begin = m.createdAt;
    const end = m.accessEndsAt ?? m.createdAt;
    return {
      begin,
      end,
      // Түр зогсоосон гишүүнд эрхийг унтраана (огноог нь хөндөхгүй).
      enable: m.status !== MemberStatus.SUSPENDED,
    };
  }
}
