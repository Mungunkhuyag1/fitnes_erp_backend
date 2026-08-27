import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { Member } from '../member/member.entity';
import { OutboxService } from '../outbox/outbox.service';
import { AuditService } from '../audit/audit.service';
import { ReconcileService } from './reconcile.service';
import { SettingsService } from '../settings/settings.service';
import { LoyaltyClient } from './loyalty.client';
import { SelectProgramDto } from './dto/select-program.dto';
import { LOYALTY_TOPICS, loyaltyGroup } from './loyalty-sync.service';

@ApiTags('loyalty')
@ApiBearerAuth('access-token')
@Controller()
export class LoyaltyController {
  constructor(
    private readonly client: LoyaltyClient,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly reconcile: ReconcileService,
  ) {}

  // ── Loopy программ ──

  /**
   * Loopy дээрх идэвхтэй программууд + одоо сонгогдсон нь.
   *
   * Сонголтыг DB-д хадгална (`loopy_program_id`) — программ солиход
   * deploy шаардахгүй. Тохируулаагүй бол `LOOPY_PROGRAM_ID` env хэрэглэнэ.
   */
  @Roles(Role.ADMIN)
  @Get('loyalty/programs')
  @ApiOperation({ summary: 'Loopy программуудын жагсаалт' })
  async programs() {
    const [items, selected] = await Promise.all([
      this.client.listPrograms(),
      this.settings.get('loopy_program_id'),
    ]);
    return {
      items,
      selected: selected ?? null,
      /** Тохиргоо хоосон үед ажиллах нөөц утга. */
      envFallback: this.client.envProgramId(),
    };
  }

  @Roles(Role.ADMIN)
  @Patch('loyalty/program')
  @ApiOperation({ summary: 'Ажиллах программыг сонгох' })
  async selectProgram(@Body() dto: SelectProgramDto) {
    // ⚠ Loopy дээр ҮНЭХЭЭР байгаа эсэхийг шалгана. Байхгүй ID хадгалбал
    // карттай холбоотой БҮХ үйлдэл чимээгүй унана.
    const items = await this.client.listPrograms();
    const found = items.find((p) => p.id === dto.programId);
    if (!found) {
      throw new BadRequestException('Ийм программ Loopy дээр олдсонгүй');
    }
    const before = await this.settings.get('loopy_program_id');
    await this.settings.set('loopy_program_id', dto.programId);
    await this.audit.record({
      staffUserId: null,
      action: 'settings.loopyProgram',
      entity: 'settings',
      entityId: 'loopy_program_id',
      before: { programId: before },
      after: { programId: dto.programId, name: found.name },
    });
    return { ok: true, programId: dto.programId, name: found.name };
  }

  // ── Loopy-гийн зөвшөөрөгдсөн дугаарын жагсаалт ──

  /**
   * Loopy ↔ WinFit жагсаалтын ЗӨРҮҮ — устгахаас ӨМНӨ харах.
   *
   * `extras` нь Loopy дээр байгаа ч WinFit-д байхгүй дугаарууд. Тэдгээр
   * нь хуучин, устгагдсан гишүүдийнх байж болох ч ӨӨР эх сурвалжийнх ч
   * байж болно — тиймээс автоматаар устгахгүй.
   */
  @Roles(Role.ADMIN)
  @Get('loyalty/allowlist/diff')
  @ApiOperation({ summary: 'Зөвшөөрөгдсөн дугаарын зөрүү' })
  allowlistDiff() {
    return this.reconcile.allowlistDiff();
  }

  @Roles(Role.ADMIN)
  @Post('loyalty/allowlist/cleanup')
  @ApiOperation({ summary: 'Илүү дугаарыг Loopy-гоос хасах' })
  async allowlistCleanup(@Body() body: { phones?: string[] }) {
    const diff = await this.reconcile.allowlistDiff();
    // ⚠ Дуудагчийн өгсөн жагсаалтыг ШУУД хэрэглэхгүй — Loopy-гоос дахин
    // тооцоолсонтой ТААРСАН дугаарыг л устгана. Дэлгэц нээснээс хойш
    // гишүүн нэмэгдсэн бол түүний дугаар санамсаргүй устахгүй.
    const asked = new Set(body.phones ?? diff.extras);
    const safe = diff.extras.filter((p) => asked.has(p));
    if (!safe.length) throw new BadRequestException('Хасах дугаар алга');

    const queued = await this.reconcile.removeExtras(safe);
    await this.audit.record({
      staffUserId: null,
      action: 'loopy.allowlistCleanup',
      entity: 'settings',
      entityId: 'loopy_allowlist',
      before: { loopyTotal: diff.loopyTotal },
      after: { removed: queued, phones: safe.slice(0, 50) },
    });
    return { queued, phones: safe };
  }

  /**
   * Сонгосон программын товч мэдээлэл — ХОЁР талын тоог зэрэг харуулна.
   *
   * ЯАГААД ХОЁУЛАНГ НЬ ВЭ: WinFit «карттай» гэж бодож буй гишүүний тоо нь
   * Loopy дээрх бодит картын тоотой зөрж болно (карт устсан, өөр программ
   * руу үүссэн, тулгалт хийгдээгүй). Зөрүүг ил харуулснаар админ шөнийн
   * тулгалтыг хүлээхгүй шууд мэднэ.
   */
  @Roles(Role.ADMIN)
  @Get('loyalty/program-summary')
  @ApiOperation({ summary: 'Сонгосон программын товч мэдээлэл' })
  async programSummary() {
    const [programs, selected] = await Promise.all([
      this.client.listPrograms(),
      this.settings.get('loopy_program_id'),
    ]);
    const id = selected ?? this.client.envProgramId();
    const program = programs.find((p) => p.id === id) ?? null;

    // Loopy руу гурван дуудлага — клиент өөрөө хурдны хязгаар барина.
    const [cards, phones, link] = await Promise.all([
      this.client.listProgramCards(1, 1).catch(() => ({ total: -1 })),
      this.client.listAllowedPhones().catch(() => null),
      this.client.enrollLink().catch(() => null),
    ]);

    const [row] = await this.members.query<Record<string, string>[]>(`
      SELECT count(*)                                                AS members,
             count(*) FILTER (WHERE loopy_allowed_at IS NOT NULL)    AS allowed,
             count(*) FILTER (WHERE loopy_card_serial IS NOT NULL)   AS with_card,
             count(*) FILTER (WHERE wallet_devices > 0)              AS in_wallet
      FROM members WHERE status <> 'cancelled'`);
    const n = (k: string) => Number(row?.[k] ?? 0);

    return {
      program,
      /** `null` = Loopy-гээс татаж чадсангүй (сүлжээ, эрх). */
      enrollAllowlist: link?.enrollAllowlist ?? null,
      loopy: {
        // `-1` = дуудлага унасан; 0-ээс ялгаж харуулна.
        cards: cards.total,
        allowedPhones: phones?.length ?? -1,
      },
      winfit: {
        members: n('members'),
        allowed: n('allowed'),
        withCard: n('with_card'),
        inWallet: n('in_wallet'),
      },
    };
  }

  /**
   * Сонгосон программын enroll линк.
   *
   * Гишүүн энэ хаягаар өөрөө бүртгүүлж Wallet карт авна. Ресепшнд QR
   * болгон хэвлэх, эсвэл гишүүнд илгээхэд ашиглана.
   */
  @Roles(Role.ADMIN)
  @Get('loyalty/enroll-link')
  @ApiOperation({ summary: 'Программын enroll линк (QR)' })
  enrollLink() {
    return this.client.enrollLink();
  }

  @Roles(Role.ADMIN)
  @Get('loyalty/ping')
  @ApiOperation({ summary: 'Loopy холболтыг шалгах' })
  ping() {
    return this.client.ping();
  }

  @Post('members/:id/card/resync')
  @ApiOperation({
    summary: 'Гишүүний картыг дахин sync хийх (хугацаа + талбар)',
  })
  async resyncCard(@Param('id', ParseUUIDPipe) id: string) {
    const member = await this.members.findOne({ where: { id } });
    if (!member) throw new BadRequestException('Гишүүн олдсонгүй');
    if (!member.loopyCardSerial) {
      throw new BadRequestException('Гишүүн Wallet карт үүсгээгүй байна');
    }
    await this.outbox.enqueue([
      {
        topic: LOYALTY_TOPICS.EXTEND,
        payload: { memberId: id },
        groupKey: loyaltyGroup(id),
      },
      {
        topic: LOYALTY_TOPICS.FIELDS,
        payload: { memberId: id },
        groupKey: loyaltyGroup(id),
      },
    ]);
    return { ok: true };
  }
}
