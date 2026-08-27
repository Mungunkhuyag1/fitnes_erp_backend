import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { date as fmtDate } from './loyalty.format';
import {
  LockerAssignment,
  LockerAssignmentType,
} from '../locker/locker-assignment.entity';
import { Member } from '../member/member.entity';
import { PermanentError } from '../outbox/outbox.errors';
import { OutboxRegistry } from '../outbox/outbox.registry';
import { LoyaltyClient } from './loyalty.client';

/** Outbox topic — Loopy руу чиглэсэн. */
export const LOYALTY_TOPICS = {
  ALLOW_PHONE: 'loopy.allowPhone',
  DISALLOW_PHONE: 'loopy.disallowPhone',
  EXTEND: 'loopy.extend',
  STATUS: 'loopy.status',
  FIELDS: 'loopy.fields',
  PUSH: 'loopy.push',
} as const;

/** Гишүүн бүрийн Loopy үйлдлийг дарааллаар барих түлхүүр. */
export const loyaltyGroup = (memberId: string): string => `loopy:${memberId}`;

@Injectable()
export class LoyaltySyncService implements OnModuleInit {
  private readonly log = new Logger(LoyaltySyncService.name);

  constructor(
    private readonly client: LoyaltyClient,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(LockerAssignment)
    private readonly assignments: Repository<LockerAssignment>,
    private readonly registry: OutboxRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(LOYALTY_TOPICS.ALLOW_PHONE, (p) =>
      this.withMember(p, async (m) => {
        await this.client.allowPhone(m.phone, m.name, `WinFit №${m.memberNo}`);
        // Амжилттай болсныг ТЭМДЭГЛЭНЭ. Үүнгүй бол «Loopy руу хүрээгүй» ба
        // «хүрсэн ч гишүүн карт үүсгээгүй» хоёр ялгагдахгүй — ажилтан юу
        // хийхээ мэдэхгүй болно.
        await this.members.update(m.id, { loopyAllowedAt: new Date() });
      }),
    );

    this.registry.register(LOYALTY_TOPICS.DISALLOW_PHONE, async (p) => {
      const phone = p.phone as string | undefined;
      if (!phone) throw new PermanentError('payload-д phone алга');

      // ★ ХОЦРОГДСОН КОМАНДААС ХАМГААЛАХ
      //
      // Энэ бол цорын ганц handler бөгөөд `payload`-даа ТӨЛӨВИЙН ХУУЛБАР
      // (тэр агшны утас) авч явдаг. Бусад нь зөвхөн `memberId` авч,
      // гүйцэтгэх үедээ сангаас шинэ утга уншдаг тул дараалал алдагдсан
      // ч эцсийн төлөв зөв гардаг.
      //
      // Хоцрогдсон тохиолдол:
      //   утас A→B (disallow(A) УНАВ) → утас B→A буцаав → A-г дахин оролдов
      // Энэ үед A нь ОДОО ашиглагдаж буй утас болсон байх ба хасвал
      // гишүүн карт үүсгэж чадахгүй болно.
      //
      // Тиймээс хасахаасаа өмнө тэр дугаар цуцлагдаагүй гишүүнд
      // харьяалагдаж байгаа эсэхийг шалгана.
      const owner = await this.members.findOne({
        where: { phone },
        select: { id: true, status: true },
      });
      if (owner && owner.status !== MemberStatus.CANCELLED) {
        this.log.warn(
          `disallowPhone(${phone}) алгаслаа — уг дугаар идэвхтэй гишүүнийх ` +
            '(хоцрогдсон команд байж болзошгүй)',
        );
        return;
      }

      await this.client.disallowPhone(phone);
      // Тухайн дугаартай гишүүн байвал тэмдэглэгээг арилгана. Утас
      // солигдсон үед хуучин дугаараар хайхад юу ч олдохгүй — хэвийн.
      await this.members.update({ phone }, { loopyAllowedAt: null });
    });

    this.registry.register(LOYALTY_TOPICS.EXTEND, (p) =>
      this.withCard(p, async (m, serial) => {
        const res = await this.client.extendCard(
          serial,
          m.accessEndsAt,
          `WinFit — ${m.accessEndsAt ? fmtDate(m.accessEndsAt, this.tz) : 'хугацаагүй'}`,
        );
        if (res.changed) {
          this.log.log(
            `Loopy карт сунгав: №${m.memberNo} → ${res.expiresAt ?? 'хугацаагүй'}`,
          );
        }
      }),
    );

    this.registry.register(LOYALTY_TOPICS.STATUS, (p) =>
      this.withCard(p, async (m, serial) => {
        // Зогссон/цуцлагдсан гишүүний карт хүчингүй байх ёстой.
        const revoked =
          m.status === MemberStatus.SUSPENDED ||
          m.status === MemberStatus.CANCELLED;
        await this.client.setCardStatus(
          serial,
          revoked ? 'revoked' : 'active',
          `WinFit: ${m.status}`,
        );
      }),
    );

    this.registry.register(LOYALTY_TOPICS.FIELDS, (p) =>
      this.withCard(p, async (m, serial) => {
        await this.client.setCardFields(serial, await this.fieldsFor(m));
      }),
    );

    this.registry.register(LOYALTY_TOPICS.PUSH, (p) =>
      this.withCard(p, async (m, serial) => {
        const message = p.message as string | undefined;
        if (!message) throw new PermanentError('payload-д message алга');
        const res = await this.client.pushToCard(serial, message);
        if (!res.appleDevices) {
          // Хүрээгүй нь алдаа БИШ — карт нэмээгүй хүн байж болно. Гэхдээ
          // мэдэж байх нь чухал: тэр гишүүнд залгах шаардлагатай.
          this.log.warn(
            `Push илгээв ч төхөөрөмж алга: №${m.memberNo} ${m.name}`,
          );
        }
      }),
    );
  }

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  /**
   * Картын ард гарах талбарууд.
   *
   * `pay_token` нь гишүүн бүрд өөр тул линк нь ХУВИЙН — картаа нээгээд шууд
   * төлбөрөө хийнэ (docs/01-integration-model.md §6.6, 2-р түвшин).
   */
  private async fieldsFor(
    m: Member,
  ): Promise<{ key: string; label: string; value: string }[]> {
    // Ташуу зураасыг `configuration.ts` аль хэдийн арилгасан.
    const base = this.config.get<string>('dashboardUrl') ?? '';
    const fields = [
      { key: 'winfitPay', label: 'Эрх сунгах', value: `${base}/pay/${m.payToken}` },
    ];
    if (m.accessEndsAt) {
      fields.push({
        key: 'winfitEnds',
        label: 'Эрх дуусах',
        value: fmtDate(m.accessEndsAt, this.tz),
      });
    }

    // ── Шүүгээний ТҮРЭЭС ──
    //
    // Зөвхөн түрээс: өдрийн шүүгээ өдөр бүр өөр байх ба картад бичих
    // хооронд хэдэн ч удаа солигдоно — карт мөнхөд хоцрогдоно.
    const rental = await this.assignments.findOne({
      where: {
        memberId: m.id,
        returnedAt: IsNull(),
        type: LockerAssignmentType.RENTAL,
      },
      order: { issuedAt: 'DESC' },
    });
    if (rental) {
      fields.push({
        key: 'winfitLocker',
        label: 'Шүүгээ',
        value: rental.dueAt
          ? `${rental.lockerZone}${rental.lockerNumber} · ${fmtDate(rental.dueAt, this.tz)} хүртэл`
          : `${rental.lockerZone}${rental.lockerNumber}`,
      });
    }
    return fields;
  }

  // ── Бүрхүүлүүд ──

  private async withMember(
    payload: Record<string, unknown>,
    action: (m: Member) => Promise<void>,
  ): Promise<void> {
    const memberId = payload.memberId as string | undefined;
    if (!memberId) throw new PermanentError('payload-д memberId алга');
    const member = await this.members.findOne({ where: { id: memberId } });
    if (!member) throw new PermanentError(`Гишүүн олдсонгүй: ${memberId}`);
    await action(member);
  }

  /**
   * Картын үйлдэл — гишүүн карт үүсгээгүй бол ЧИМЭЭГҮЙ алгасна.
   *
   * Карт бол зөвхөн харуулах давхарга (шийдвэр 3): олон гишүүн картгүй байх
   * нь ХЭВИЙН. Үүнийг алдаа гэж тооцвол outbox бүхэлдээ улаан болно.
   */
  private withCard(
    payload: Record<string, unknown>,
    action: (m: Member, serial: string) => Promise<void>,
  ): Promise<void> {
    return this.withMember(payload, async (m) => {
      if (!m.loopyCardSerial) {
        this.log.debug(`№${m.memberNo} картгүй — Loopy үйлдэл алгаслаа`);
        return;
      }
      await action(m, m.loopyCardSerial);
    });
  }
}
