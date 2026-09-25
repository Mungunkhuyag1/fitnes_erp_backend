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
 * Хуудас ЗААВАЛ захиалах ёстой webhook талбарууд.
 *
 * ⚠ `message_echoes`-гүй бол УТСАН дээрх Messenger-ээс бичсэн хариу
 * WinFit-д харагдахгүй: ажилтан аль хэдийн хариулсан яриаг дахин
 * хариулж, гишүүн хоёр удаа ижил зүйл сонсоно.
 *
 * `messaging_postbacks` нь товчны даралт — одоогоор товч ашиглахгүй ч
 * захиалах нь үнэгүй, хожим нэмэхэд Meta руу дахин орох шаардлагагүй.
 */
/**
 * Токенд ЗААВАЛ байх ёстой эрхүүд.
 *
 * ⚠ `pages_read_engagement` энд БАЙХГҮЙ — тэр нь зөвхөн хуудасны
 * НЭР уншихад хэрэгтэй, ажиллагаанд нөлөөгүй (`resolvePage`).
 */
const REQUIRED_SCOPES = [
  'pages_messaging',
  'pages_manage_metadata',
  'pages_show_list',
] as const;

const REQUIRED_FIELDS = [
  'messages',
  'message_echoes',
  'messaging_postbacks',
] as const;

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
    hasAppId: boolean;
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
      hasAppId: !!p?.appId,
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
      pageId?: string;
      appId?: string;
      token: string;
      appSecret: string;
      verifyToken: string;
    },
    staffId: string,
  ): Promise<{ pageId: string; pageName: string }> {
    const api = new MetaClient(input.token);
    const r = await this.resolvePage(
      api,
      input.token,
      input.appId?.trim() ?? null,
      input.appSecret,
    );
    const me = r.page;
    const firstError = r.error;
    if (r.viaDebug) {
      this.log.warn(
        'Хуудасны нэр уншигдсангүй (pages_read_engagement алга) — ' +
          'токеныг debug_token-оор баталлаа',
      );
    }

    if (!me) {
      throw new BadRequestException(`Токен шалгагдсангүй: ${explain(firstError)}`);
    }

    /*
     * Page ID ӨГСӨН бол таарах эсэхийг шалгана — буруу хуудсын
     * токен буулгасан эсэхийг барихад. Өгөөгүй бол токеныхыг авна.
     */
    const wanted = input.pageId?.trim();
    if (wanted && me.id !== wanted) {
      /*
       * ⚠ Нэрийг зөвхөн МЭДЭГДЭЖ байвал бичнэ.
       *
       * `debug_token`-оор нөхсөн үед нэр нь «Хуудас <id>» болдог тул
       * «Хуудас 976… (976…)» гэж ижил дугаар хоёр удаа гарч, ажилтан
       * «хоёр өөр хуудас уу?» гэж эргэлзэнэ.
       */
      const who = me.name.endsWith(me.id) ? me.id : `${me.name} (${me.id})`;
      throw new BadRequestException(
        `Токен нь ${who} хуудсынх байна, та ${wanted} гэж бичжээ. ` +
          'Page ID-г засах эсвэл хоосон орхино уу.',
      );
    }

    // Нэг идэвхтэй хуудас — өмнөхийг унтраана.
    await this.pages.update({ active: true }, { active: false });

    const existing = await this.pages.findOne({ where: { pageId: me.id } });
    const row = existing ?? this.pages.create({ pageId: me.id });
    row.pageName = me.name;
    row.tokenEnc = seal(input.token, this.key);
    row.appSecretEnc = seal(input.appSecret, this.key);
    // ⚠ Хоосон бол ӨМНӨХИЙГ УСТГАХГҮЙ: маягтыг дахин бөглөхдөө
    // App ID-г орхиход хугацааны шалгалт чимээгүй унтарна.
    if (input.appId?.trim()) row.appId = input.appId.trim();
    row.verifyToken = input.verifyToken;
    row.active = true;
    row.connectedAt = new Date();
    row.connectedBy = staffId;
    await this.pages.save(row);

    this.log.log(`Facebook хуудас холбогдлоо: ${me.name} (${me.id})`);
    return { pageId: me.id, pageName: me.name };
  }

  /**
   * ХОЛБОЛТЫН ОНОШИЛГОО.
   *
   * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
   *
   * Тохиргооны маягт нь «хадгалагдлаа» гэж хэлнэ, Meta-гийн самбар
   * «Verified» гэж хэлнэ — гэтэл НЭГ Ч мессеж ирэхгүй байж болно.
   * Шалтгаан нь ихэвчлэн гурвын нэг:
   *
   *   1. хуудсыг аппад ЗАХИАЛААГҮЙ (`subscribed_apps` хоосон)
   *   2. `message_echoes` захиалаагүй — утаснаас бичсэн хариу алга
   *   3. токен хугацаа дууссан (60 хоног) — чимээгүй үхсэн
   *
   * Гуравт нь ч дэлгэц дээр ялгаагүй харагдана. Энэ дуудлага нь
   * ТААМАГЛАЛЫГ баримтаар солино.
   *
   * ⚠ Алдааг ШИДЭХГҮЙ. Оношилгоо нь бүтэлгүйтсэн ч ҮЛДСЭН мэдээллийг
   * харуулах ёстой: «токен унасан» гэдэг нь өөрөө хариулт.
   */
  async check(): Promise<{
    connected: boolean;
    token: { ok: boolean; error?: string; note?: string };
    page: { id: string; name: string } | null;
    /**
     * `'never'` — хэзээ ч дуусахгүй
     * `null`    — App ID өгөөгүй тул шалгах боломжгүй
     * `'unknown'` — App ID байгаа ч шалгалт бүтсэнгүй
     */
    expiresAt: Date | null | 'never' | 'unknown';
    /**
     * Токенд ЯГ ЯМАР эрх байгаа (`debug_token`-оос).
     *
     * ⚠ Үүнгүй бол «ямар эрх дутуу вэ» гэдгийг ТААМАГЛАХ л үлддэг:
     * Meta-гийн самбарт эрх «нэмэгдсэн» харагдаж байхад токенд нь
     * ороогүй байх нь энэ тохиргооны ХАМГИЙН олон удаа тохиолдсон
     * алдаа. Жагсаалт нь маргааныг таслана.
     */
    scopes: string[];
    /** Ажиллахад ЗААВАЛ хэрэгтэй атлаа токенд алга. */
    missingScopes: string[];
    subscription: {
      /** Хуудас ЭНЭ аппад захиалагдсан эсэх. */
      subscribed: boolean;
      fields: string[];
      /** Дутуу байгаа ЗАЙЛШГҮЙ талбарууд. */
      missing: string[];
      error?: string;
    };
    webhookUrl: string;
  }> {
    const base = this.config.get<string>('apiBaseUrl') ?? '';
    const webhookUrl = `${base}/api/webhooks/meta`;
    const p = await this.page();
    if (!p?.tokenEnc) {
      return {
        connected: false,
        token: { ok: false, error: 'Хуудас холбогдоогүй байна' },
        page: null,
        expiresAt: null,
        scopes: [],
        missingScopes: [...REQUIRED_SCOPES],
        subscription: { subscribed: false, fields: [], missing: [...REQUIRED_FIELDS] },
        webhookUrl,
      };
    }

    const token = open(p.tokenEnc, this.key);
    if (!token) {
      return {
        connected: false,
        token: { ok: false, error: 'Токен уншигдсангүй — дахин холбоно уу' },
        page: null,
        expiresAt: null,
        scopes: [],
        missingScopes: [...REQUIRED_SCOPES],
        subscription: { subscribed: false, fields: [], missing: [...REQUIRED_FIELDS] },
        webhookUrl,
      };
    }
    const api = new MetaClient(token);
    const secret = p.appSecretEnc ? open(p.appSecretEnc, this.key) : null;

    // ── 1. Токен амьд эсэх — `connect()`-тэй ИЖИЛ логикоор ──
    const r = await this.resolvePage(api, token, p.appId, secret);
    const page = r.page;
    const tokenErr = r.error || undefined;

    // ── 2. Хэзээ дуусах (App ID өгсөн бол) ──
    /*
     * ⚠ `'unknown'` ба `null` хоёрыг ЯЛГАНА.
     *
     * Өмнө нь хоёуланг `null` болгож «App ID өгөөгүй тул мэдэхгүй»
     * гэж харуулдаг байв — гэтэл App ID хадгалагдсан, зүгээр л
     * `/me` унасан тул энэ блок огт ажиллаагүй байлаа. Ажилтан
     * байхгүй асуудлыг хөөнө.
     */
    let expiresAt: Date | null | 'never' | 'unknown' = null;
    let scopes: string[] = [];
    if (page && p.appId && secret) {
      try {
        const d = await api.debugToken(token, `${p.appId}|${secret}`);
        // ⚠ `0` бол ХЭЗЭЭ Ч дуусахгүй — `new Date(0)` нь 1970 он гэж
        // харагдах тул ЗААВАЛ тусад нь тэмдэглэнэ.
        expiresAt = !d.expires_at ? 'never' : new Date(d.expires_at * 1000);
        scopes = d.scopes ?? [];
      } catch {
        expiresAt = 'unknown';
      }
    } else if (page && !p.appId) {
      expiresAt = null; // App ID үнэхээр өгөөгүй
    } else if (page) {
      expiresAt = 'unknown';
    }

    // ── 3. Хуудас аппад захиалагдсан уу, ямар талбараар ──
    let fields: string[] = [];
    let subscribed = false;
    let subErr: string | undefined;
    if (page) {
      try {
        const apps = await api.subscribedApps(page.id);
        subscribed = apps.length > 0;
        // Хэд хэдэн апп захиалагдсан байж болно — БҮГДИЙГ нэгтгэнэ.
        fields = [...new Set(apps.flatMap((a) => a.subscribed_fields ?? []))];
      } catch (e) {
        subErr = e instanceof MetaApiError ? e.detail : String(e);
      }
    }

    return {
      connected: !!page,
      token: page
        ? {
            ok: true,
            // Токен АЖИЛЛАЖ байна, зүгээр л нэрийг уншиж чадаагүй.
            note: r.viaDebug
              ? 'Нэр уншигдсангүй (pages_read_engagement алга) — ажиллагаанд нөлөөгүй'
              : undefined,
          }
        : { ok: false, error: tokenErr },
      page,
      expiresAt,
      scopes,
      /*
       * ⚠ `scopes` хоосон байвал «бүгд дутуу» гэж ХЭЛЭХГҮЙ — App ID
       * өгөөгүй эсвэл debug_token унасан байж болно. Худал улаан
       * жагсаалт нь байхгүй асуудал хөөлгөнө.
       */
      missingScopes: scopes.length
        ? REQUIRED_SCOPES.filter((x) => !scopes.includes(x))
        : [],
      subscription: {
        subscribed,
        fields,
        missing: REQUIRED_FIELDS.filter((f) => !fields.includes(f)),
        error: subErr,
      },
      webhookUrl,
    };
  }

  /**
   * Хуудсыг аппад ЗАХИАЛАХ — нэг товчоор.
   *
   * Энэ алхам нь Meta-гийн самбарт гараар хийгддэг ба хамгийн олон
   * удаа мартагддаг. Graph нь үүнийг page token-оор зөвшөөрдөг тул
   * гараар хийлгэх шаардлагагүй.
   */
  async subscribe(): Promise<{ ok: true; fields: string[] }> {
    const p = await this.page();
    if (!p) throw new BadRequestException('Хуудас холбогдоогүй байна');
    const api = await this.client(p);
    try {
      await api.subscribeApp(p.pageId, REQUIRED_FIELDS);
    } catch (e) {
      const detail = e instanceof MetaApiError ? e.detail : String(e);
      throw new BadRequestException(
        `Захиалга бүтсэнгүй: ${detail}. Токен нь pages_manage_metadata ` +
          'эрхтэй эсэхийг шалгана уу.',
      );
    }
    this.log.log(`Facebook хуудас захиалагдлаа: ${p.pageName ?? p.pageId}`);
    return { ok: true as const, fields: [...REQUIRED_FIELDS] };
  }

  /**
   * ТОКЕНООС ХУУДСЫГ ТОДОРХОЙЛОХ — хоёр аргаар.
   *
   * ★ ЯАГААД НЭГ ГАЗАР ВЭ
   *
   * Эхлээд нөөц замыг зөвхөн `connect()`-д бичсэн нь АЛДАА байв:
   * холболт амжилттай болсон атлаа «Шалгах» нь ЯГ ТЭР токеныг
   * «унасан» гэж хэлж, ажилтан алийг нь итгэхээ мэдэхгүй болов.
   * Хоёр зам нэг дүгнэлт өгөх ёстой.
   *
   * `/me` нь нэрийг өгдөг ч `pages_read_engagement` шаарддаг —
   * Messenger use case түүнийг өгдөггүй. Унавал `/debug_token`
   * (аппын токен, хуудасны эрх шаардахгүй) нь ID-г өгнө.
   */
  private async resolvePage(
    api: MetaClient,
    token: string,
    appId: string | null,
    appSecret: string | null,
  ): Promise<{
    page: { id: string; name: string } | null;
    /** Нэр уншигдсангүй — ID-гаар нэрлэсэн. */
    viaDebug: boolean;
    error: string;
  }> {
    try {
      return { page: await api.me(), viaDebug: false, error: '' };
    } catch (e) {
      const error = e instanceof MetaApiError ? e.detail : String(e);
      if (!appId || !appSecret) return { page: null, viaDebug: false, error };
      try {
        const d = await api.debugToken(token, `${appId}|${appSecret}`);
        if (d.is_valid && d.profile_id) {
          return {
            page: { id: d.profile_id, name: `Хуудас ${d.profile_id}` },
            viaDebug: true,
            error: '',
          };
        }
      } catch {
        // App ID буруу байж болно — анхны алдааг дамжуулна.
      }
      return { page: null, viaDebug: false, error };
    }
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

  /**
   * ⚠ ИДЭВХТЭЙ ХУУДАСНЫХЫГ Л.
   *
   * Тест хуудсаар туршаад дараа нь жинхэнэ хуудас руу шилжих нь
   * хэвийн урсгал. Шүүхгүй бол тестийн ярианууд хайрцагт үлдэж,
   * ажилтан хариулах гэж оролдоод буруу хуудсанд илгээнэ.
   *
   * Хуучин мөрүүд САНД ҮЛДЭНЭ — буцаад тэр хуудсыг холбовол
   * дахин харагдана. Устгах нь түүхийг алдах тул зориуд хийхгүй.
   */
  async list(limit = 50): Promise<ConversationRow[]> {
    const p = await this.page();
    if (!p) return [];
    const rows = await this.convos.find({
      where: { pageId: p.pageId },
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

  /** ⚠ Мөн ИДЭВХТЭЙ хуудсныхыг л — тэмдэг хуучин яриаг тоолох ёсгүй. */
  async unreadCount(): Promise<{ total: number }> {
    const p = await this.page();
    if (!p) return { total: 0 };
    const r = await this.convos
      .createQueryBuilder('c')
      .where('c.page_id = :pid', { pid: p.pageId })
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

/**
 * Meta-гийн алдааг ХИЙХ ЗҮЙЛ болгон хөрвүүлнэ.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * Graph-ийн алдаанууд нь баримтын гурван холбоос бүхий 300 тэмдэгтийн
 * англи догол мөр байдаг. Ажилтан түүнийг уншаад ЮУ дарахаа мэдэхгүй.
 * Хамгийн түгээмэл гурвыг нь шууд зааврaaр солино.
 *
 * ⚠ Танихгүй алдааг НУУХГҮЙ — эх бичвэрийг нь дамжуулна. Буруу
 * таамаглаж «засвар» санал болговол ажилтан байхгүй асуудлыг хөөнө.
 */
function explain(detail: string): string {
  // (#100) … 'pages_read_engagement' …
  if (/pages_read_engagement|Page Public (Content|Metadata) Access/i.test(detail)) {
    return (
      'Токенд «pages_read_engagement» эрх дутуу байна. ' +
      'Meta → апп → Customize use case → Permissions and features → ' +
      '«pages_read_engagement» нэмээд, дараа нь Messenger API Settings ' +
      '→ Generate token-оор токеныг ДАХИН ҮҮСГЭ. ' +
      '⚠ Эрх нь токен дотор шигтгэгддэг тул хуучин токен ажиллахгүй. ' +
      '(docs/17 §11)'
    );
  }
  // 190 = токен хүчингүй / хугацаа дууссан
  if (/expired|session has been invalidated|Error validating access token/i.test(detail)) {
    return (
      'Токен хүчингүй эсвэл хугацаа дууссан байна. Meta → Messenger ' +
      'API Settings → Generate token-оор шинийг үүсгэнэ үү. ' +
      'Хэзээ ч дуусахгүй токен авах: docs/17 §4'
    );
  }
  if (/Invalid OAuth access token|Cannot parse access token/i.test(detail)) {
    return (
      'Токен буруу хуулагдсан бололтой — эхэнд/төгсгөлд нь зай, эсвэл ' +
      'дутуу байж магадгүй. Бүтнээр нь дахин хуулна уу.'
    );
  }
  return detail;
}
