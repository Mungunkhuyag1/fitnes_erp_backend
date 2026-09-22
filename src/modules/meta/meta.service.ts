import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { open, seal } from '../../common/utils/secret-box';
import { MetaConversation } from './meta-conversation.entity';
import { MetaMessage, type MetaAttachment } from './meta-message.entity';
import { MetaPage } from './meta-page.entity';
import { MetaApiError, MetaClient } from './meta.client';

/**
 * ★ ХАРИУ БИЧИХ ЦОНХ — META-ГИЙН ДҮРЭМ
 *
 * Хэрэглэгч сүүлд бичсэнээс хойш:
 *   · 24 цаг   — чөлөөтэй хариулна (`RESPONSE`)
 *   · 7 хоног  — ХҮН гараар хариулж байвал (`HUMAN_AGENT` тэг)
 *   · цаашид   — хариулах боломжгүй
 *
 * Эдгээр нь Meta-гийн бодлого; бид зөвхөн дагана.
 */
const WINDOW_FREE_H = 24;
const WINDOW_AGENT_H = 24 * 7;

/** Ярианы жагсаалтад харагдах товч мэдээлэл. */
export interface ConversationRow {
  id: string;
  psid: string;
  name: string | null;
  pictureUrl: string | null;
  lastMessageAt: Date | null;
  lastMessageText: string | null;
  unread: number;
  /** Хариу бичих боломж — дэлгэц үүгээр талбараа хаана. */
  window: 'open' | 'agent' | 'closed';
  member: { id: string; name: string; memberNo: string; status: string } | null;
}

@Injectable()
export class MetaService {
  private readonly log = new Logger(MetaService.name);

  constructor(
    @InjectRepository(MetaPage) private readonly pages: Repository<MetaPage>,
    @InjectRepository(MetaConversation)
    private readonly convos: Repository<MetaConversation>,
    @InjectRepository(MetaMessage)
    private readonly messages: Repository<MetaMessage>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Битүүмжлэлийн түлхүүр.
   *
   * `devices.password_enc`-тэй ИЖИЛ түлхүүр ашиглана — нэг системд хоёр
   * түлхүүр байх нь аль нэгийг нь сэлгэхэд мартагдах эрсдэлтэй.
   */
  private get key(): string {
    return this.config.getOrThrow<string>('jwt.secret');
  }

  // ══════════════════════════════════════════════════════════════
  //  Холболт
  // ══════════════════════════════════════════════════════════════

  /** Идэвхтэй хуудас. Холбогдоогүй бол `null`. */
  async page(): Promise<MetaPage | null> {
    return this.pages.findOne({ where: { active: true } });
  }

  /**
   * Дэлгэцэд харуулах төлөв.
   *
   * ⚠ Токен, app secret хоёрыг ХЭЗЭЭ Ч буцаахгүй — зөвхөн тавигдсан
   * эсэхийг. Тохируулсан хүн ч дахин харах шаардлагагүй.
   */
  async status(): Promise<{
    connected: boolean;
    pageId: string | null;
    pageName: string | null;
    verifyToken: string | null;
    hasToken: boolean;
    hasAppSecret: boolean;
    connectedAt: Date | null;
    webhookUrl: string;
  }> {
    const p = await this.page();
    const base = this.config.get<string>('apiBaseUrl') ?? '';
    return {
      connected: !!p?.tokenEnc,
      pageId: p?.pageId ?? null,
      pageName: p?.pageName ?? null,
      verifyToken: p?.verifyToken ?? null,
      hasToken: !!p?.tokenEnc,
      hasAppSecret: !!p?.appSecretEnc,
      connectedAt: p?.connectedAt ?? null,
      webhookUrl: `${base}/api/webhooks/meta`,
    };
  }

  /**
   * Холболтыг хадгалах.
   *
   * ⚠ ХАДГАЛАХААС ӨМНӨ ТОКЕНЫГ ШАЛГАНА. Буруу токен хадгалагдвал
   * webhook ирсээр байгаад хариу илгээх бүрд унана — ажилтан
   * шалтгааныг нь мэдэхгүй.
   */
  async connect(
    input: {
      pageId: string;
      token: string;
      appSecret: string;
      verifyToken: string;
    },
    staffId: string,
  ): Promise<{ pageId: string; pageName: string }> {
    let me: { id: string; name: string };
    try {
      me = await new MetaClient(input.token).me();
    } catch (e) {
      const detail = e instanceof MetaApiError ? e.detail : String(e);
      throw new BadRequestException(`Токен шалгагдсангүй: ${detail}`);
    }

    if (me.id !== input.pageId.trim()) {
      throw new BadRequestException(
        `Токен нь өөр хуудсынх байна: ${me.name} (${me.id}). ` +
          'Page ID-г шалгана уу.',
      );
    }

    // Нэг идэвхтэй хуудас — өмнөхийг унтраана.
    await this.pages.update({ active: true }, { active: false });

    const existing = await this.pages.findOne({ where: { pageId: me.id } });
    const row = existing ?? this.pages.create({ pageId: me.id });
    row.pageName = me.name;
    row.tokenEnc = seal(input.token, this.key);
    row.appSecretEnc = seal(input.appSecret, this.key);
    row.verifyToken = input.verifyToken;
    row.active = true;
    row.connectedAt = new Date();
    row.connectedBy = staffId;
    await this.pages.save(row);

    this.log.log(`Facebook хуудас холбогдлоо: ${me.name} (${me.id})`);
    return { pageId: me.id, pageName: me.name };
  }

  async disconnect(): Promise<{ ok: true }> {
    await this.pages.update({ active: true }, { active: false });
    this.log.warn('Facebook хуудасны холболт салгагдлаа');
    return { ok: true };
  }

  /** Битүүмжилсэн токеныг задалж клиент үүсгэнэ. */
  private async client(p: MetaPage): Promise<MetaClient> {
    const token = p.tokenEnc ? open(p.tokenEnc, this.key) : null;
    if (!token) {
      throw new BadRequestException(
        'Facebook хуудас холбогдоогүй эсвэл токен уншигдсангүй',
      );
    }
    return new MetaClient(token);
  }

  /** Webhook-ийн гарын үсгийг шалгах app secret. */
  async appSecret(): Promise<string | null> {
    const p = await this.page();
    return p?.appSecretEnc ? open(p.appSecretEnc, this.key) : null;
  }

  async verifyToken(): Promise<string | null> {
    return (await this.page())?.verifyToken ?? null;
  }

  // ══════════════════════════════════════════════════════════════
  //  Хүлээж авах
  // ══════════════════════════════════════════════════════════════

  /**
   * Webhook-оос ирсэн нэг мессежийг бүртгэх.
   *
   * ⚠ ИДЕМПОТЕНТ. Meta нь 200 хариу авахгүй бол ДАХИН илгээдэг ба
   * бидний өөрсдийн илгээсэн мессеж `message_echoes`-оор буцаж ирдэг.
   * `mid` дээрх UNIQUE + `orIgnore()` хоёулангийнх нь эсрэг хамгаална.
   */
  async ingest(input: {
    pageId: string;
    psid: string;
    mid: string;
    direction: 'in' | 'out';
    text: string | null;
    attachments: MetaAttachment[] | null;
    sentAt: Date;
  }): Promise<boolean> {
    const convo = await this.upsertConversation(input.pageId, input.psid);

    const res = await this.messages
      .createQueryBuilder()
      .insert()
      .into(MetaMessage)
      .values({
        conversationId: convo.id,
        mid: input.mid,
        direction: input.direction,
        text: input.text,
        attachments: (input.attachments ?? null) as never,
        sentAt: input.sentAt,
      })
      .orIgnore()
      .execute();

    const inserted = (res.identifiers?.[0]?.id ?? null) !== null;
    if (!inserted) return false;

    /*
     * Хураангуй нь мессежгүй (зөвхөн зурагтай) байж болно — тэр үед
     * хоосон мөр харуулахын оронд хавсралтын төрлийг хэлнэ.
     */
    const summary =
      input.text?.slice(0, 500) ??
      (input.attachments?.length
        ? `[${input.attachments[0].type ?? 'хавсралт'}]`
        : null);

    convo.lastMessageAt = input.sentAt;
    convo.lastMessageText = summary;
    if (input.direction === 'in') {
      // ⚠ ЗӨВХӨН ирсэн мессеж цонхыг шинэчилнэ.
      convo.lastInboundAt = input.sentAt;
      convo.unread += 1;
    }
    await this.convos.save(convo);
    return true;
  }

  /**
   * Яриаг олох эсвэл үүсгэх. Шинэ бол профайлыг татна.
   *
   * ⚠ Профайл татагдахгүй байх нь ХЭВИЙН (нууцлал, батлагдаагүй апп) —
   * яриаг тэр шалтгаанаар алдаж болохгүй тул чимээгүй үргэлжилнэ.
   */
  private async upsertConversation(
    pageId: string,
    psid: string,
  ): Promise<MetaConversation> {
    const found = await this.convos.findOne({ where: { pageId, psid } });
    if (found) return found;

    const row = this.convos.create({ pageId, psid, unread: 0 });
    const p = await this.page();
    if (p?.tokenEnc) {
      try {
        const prof = await (await this.client(p)).profile(psid);
        row.name = prof.name ?? null;
        row.pictureUrl = prof.picture ?? null;
      } catch (e) {
        this.log.debug(
          `Профайл татагдсангүй (${psid}): ${(e as Error).message}`,
        );
      }
    }
    return this.convos.save(row);
  }

  // ══════════════════════════════════════════════════════════════
  //  Унших
  // ══════════════════════════════════════════════════════════════

  /** Хариу бичих боломжийг цонхны дүрмээр тодорхойлно. */
  private windowOf(lastInboundAt: Date | null): 'open' | 'agent' | 'closed' {
    if (!lastInboundAt) return 'closed';
    const hours = (Date.now() - lastInboundAt.getTime()) / 3_600_000;
    if (hours < WINDOW_FREE_H) return 'open';
    if (hours < WINDOW_AGENT_H) return 'agent';
    return 'closed';
  }

  async list(limit = 50): Promise<ConversationRow[]> {
    const rows = await this.convos.find({
      order: { lastMessageAt: 'DESC' },
      take: Math.min(limit, 200),
    });
    const members = await this.memberMap(rows.map((r) => r.memberId));
    return rows.map((r) => ({
      id: r.id,
      psid: r.psid,
      name: r.name,
      pictureUrl: r.pictureUrl,
      lastMessageAt: r.lastMessageAt,
      lastMessageText: r.lastMessageText,
      unread: r.unread,
      window: this.windowOf(r.lastInboundAt),
      member: r.memberId ? (members.get(r.memberId) ?? null) : null,
    }));
  }

  async unreadCount(): Promise<{ total: number }> {
    const r = await this.convos
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.unread), 0)', 'n')
      .getRawOne<{ n: string }>();
    return { total: Number(r?.n ?? 0) };
  }

  async thread(id: string): Promise<{
    conversation: ConversationRow;
    messages: MetaMessage[];
  }> {
    const c = await this.convos.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Яриа олдсонгүй');
    const messages = await this.messages.find({
      where: { conversationId: id },
      order: { sentAt: 'ASC' },
      take: 200,
    });
    const members = await this.memberMap([c.memberId]);
    return {
      conversation: {
        id: c.id,
        psid: c.psid,
        name: c.name,
        pictureUrl: c.pictureUrl,
        lastMessageAt: c.lastMessageAt,
        lastMessageText: c.lastMessageText,
        unread: c.unread,
        window: this.windowOf(c.lastInboundAt),
        member: c.memberId ? (members.get(c.memberId) ?? null) : null,
      },
      messages,
    };
  }

  /** Уншсан гэж тэмдэглэх — ажилтан яриаг нээхэд. */
  async markRead(id: string): Promise<{ ok: true }> {
    await this.convos.update({ id }, { unread: 0 });
    return { ok: true };
  }

  /** Гишүүнтэй холбох / салгах. */
  async linkMember(id: string, memberId: string | null): Promise<{ ok: true }> {
    const c = await this.convos.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Яриа олдсонгүй');
    c.memberId = memberId;
    await this.convos.save(c);
    return { ok: true };
  }

  // ══════════════════════════════════════════════════════════════
  //  Илгээх
  // ══════════════════════════════════════════════════════════════

  /**
   * Хариу илгээх.
   *
   * ⚠ Илгээлт БҮТЭЛГҮЙТВЭЛ мөр нь `error`-той хадгалагдана. Чимээгүй
   * алдагдвал ажилтан хариулсан гэж бодоод хүлээнэ.
   */
  async send(
    id: string,
    text: string,
    staffId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const c = await this.convos.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Яриа олдсонгүй');

    const win = this.windowOf(c.lastInboundAt);
    if (win === 'closed') {
      throw new BadRequestException(
        'Хариу бичих хугацаа дууссан. Facebook нь хэрэглэгч сүүлд ' +
          'бичсэнээс хойш 7 хоногийн дотор л хариулахыг зөвшөөрдөг.',
      );
    }

    const p = await this.page();
    if (!p) throw new BadRequestException('Facebook хуудас холбогдоогүй');
    const api = await this.client(p);

    const body = text.trim();
    if (!body) throw new BadRequestException('Мессеж хоосон байна');

    try {
      const r = await api.send(p.pageId, c.psid, body, {
        humanAgent: win === 'agent',
      });
      /*
       * ⚠ `message_echoes` мөн ирнэ. Тэр нь ижил `mid`-тэй тул
       *   UNIQUE индекс давхардлыг хаана — энд шууд бичих нь
       *   дэлгэц дээр ТЭР ДАРУЙ харагдахын тулд.
       */
      await this.ingest({
        pageId: p.pageId,
        psid: c.psid,
        mid: r.message_id,
        direction: 'out',
        text: body,
        attachments: null,
        sentAt: new Date(),
      });
      await this.messages.update({ mid: r.message_id }, { staffUserId: staffId });
      return { ok: true };
    } catch (e) {
      const detail = e instanceof MetaApiError ? e.detail : (e as Error).message;
      // Алдаатай оролдлогыг ч ТҮҮХЭНД үлдээнэ.
      await this.messages.save(
        this.messages.create({
          conversationId: c.id,
          mid: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          direction: 'out',
          text: body,
          staffUserId: staffId,
          error: detail.slice(0, 500),
          sentAt: new Date(),
        }),
      );
      this.log.error(`Мессеж илгээгдсэнгүй (${c.psid}): ${detail}`);
      return { ok: false, error: detail };
    }
  }

  // ══════════════════════════════════════════════════════════════

  /**
   * Гишүүдийн товч мэдээлэл — ТҮҮХИЙ асуулгаар.
   *
   * `MetaConversation` нь `Member`-тэй харилцаагүй: модуль хоорондын
   * хамаарал үүсгэхгүйн тулд (`task.service`-тэй ижил арга).
   */
  private async memberMap(
    ids: (string | null)[],
  ): Promise<
    Map<string, { id: string; name: string; memberNo: string; status: string }>
  > {
    const clean = [...new Set(ids.filter((v): v is string => !!v))];
    if (!clean.length) return new Map();
    const rows = await this.convos.manager.query<
      { id: string; name: string; member_no: string; status: string }[]
    >(`SELECT id, name, member_no, status FROM members WHERE id = ANY($1)`, [
      clean,
    ]);
    return new Map(
      rows.map((r) => [
        r.id,
        { id: r.id, name: r.name, memberNo: r.member_no, status: r.status },
      ]),
    );
  }
}
