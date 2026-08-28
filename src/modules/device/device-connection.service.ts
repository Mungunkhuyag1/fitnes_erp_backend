import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { networkInterfaces } from 'os';
import { Repository } from 'typeorm';
import { open, seal } from '../../common/utils/secret-box';
import { Device } from './device.entity';

/** Терминалтай ярихад хэрэгтэй бүх зүйл. */
export interface DeviceConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  https: boolean;
}

/** Талбар бүр хаанаас ирснийг дэлгэцэд харуулна. */
type Src = 'db' | 'env' | 'none';

/**
 * Терминалын IP хаягийг шийдэх, автоматаар дахин олох.
 *
 * ЯАГААД DB-Д ХАДГАЛАХ ВЭ: фитнесийн router нь DHCP-ээр хаяг тарааж,
 * тодорхой хугацааны дараа терминалын IP СОЛИГДДОГ. `.env` дээр
 * бичсэн бол хаяг солигдох бүрд файл засаад дахин deploy хийх
 * шаардлагатай болно — ашиглалтад тохирохгүй.
 *
 * Эрэмбэ:
 *   1. `devices` хүснэгт дэх идэвхтэй мөрийн `ip`
 *   2. `.env` дэх `HIK_HOST` — анхны суулгалт, эсвэл DB хоосон үед
 *
 * Холболт унавал `discover()` нь дэд сүлжээг сканнердаж, ISAPI хариулсан
 * хаягийг олоод DB-д бичнэ.
 */
@Injectable()
export class DeviceConnectionService {
  private readonly log = new Logger(DeviceConnectionService.name);
  /** Сканнердах хугацаа — хэт богино бол алсын төхөөрөмж алдагдана. */
  private static readonly PROBE_MS = 1_200;

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly config: ConfigService,
  ) {}

  private row(): Promise<Device | null> {
    return this.devices.findOne({
      where: { active: true },
      order: { createdAt: 'ASC' },
    });
  }

  /** Одоо ашиглах хаяг. */
  async host(): Promise<string | null> {
    const row = await this.row();
    return row?.ip || this.config.get<string>('hikvision.host') || null;
  }

  /**
   * Терминалтай холбогдох БҮРЭН тохиргоо: DB → `.env` талбар тус бүрээр.
   *
   * ⚠ Талбар бүрийг ТУСАД нь уначлана. Дэлгэцээс зөвхөн IP-г солиход
   * нууц үг `.env`-ээс үргэлжлэн ирэх ёстой — бүхэлд нь DB эсвэл env
   * гэж сонговол хагас тохируулга ажиллахаа болино.
   */
  async connection(): Promise<DeviceConnection | null> {
    const row = await this.row();
    const host = row?.ip || this.config.get<string>('hikvision.host') || '';
    if (!host) return null;

    const stored = row?.passwordEnc
      ? open(row.passwordEnc, this.config.getOrThrow<string>('jwt.secret'))
      : null;
    if (row?.passwordEnc && stored === null) {
      // JWT_SECRET солигдсон — нууц үгийг тайлж чадахгүй.
      this.log.warn('Хадгалсан нууц үг тайлагдсангүй — дэлгэцээс дахин оруулна уу');
    }

    return {
      host,
      port: row?.port ?? this.config.get<number>('hikvision.port') ?? 80,
      user: row?.username || this.config.get<string>('hikvision.user') || 'admin',
      password: stored ?? this.config.get<string>('hikvision.password') ?? '',
      https: row?.https ?? this.config.get<boolean>('hikvision.https') ?? false,
    };
  }

  /**
   * Дэлгэцээс ирсэн тохиргоог хадгална.
   *
   * `undefined` талбарыг ХӨНДӨХГҮЙ, хоосон мөр нь «`.env`-ээ ашигла»
   * гэсэн үг (`null` бичнэ). Нууц үгийг хоосон илгээвэл ХУУЧНААР
   * үлдэнэ — дэлгэц нууц үгийг буцааж уншиж чаддаггүй тул давхар
   * хадгалахад нь устгаж болохгүй.
   */
  async saveConnection(input: {
    ip?: string;
    port?: number | null;
    user?: string | null;
    password?: string | null;
    https?: boolean | null;
  }): Promise<void> {
    if (input.ip !== undefined) {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(input.ip)) {
        throw new BadRequestException('IP хаяг буруу байна (жиш. 192.168.0.106)');
      }
      await this.remember(input.ip);
    }
    if (input.port != null && (input.port < 1 || input.port > 65535)) {
      throw new BadRequestException('Порт 1–65535 хооронд байна');
    }

    const row = await this.row();
    if (!row) throw new BadRequestException('Эхлээд IP хаягаа оруулна уу');

    if (input.port !== undefined) row.port = input.port;
    if (input.user !== undefined) row.username = input.user || null;
    if (input.https !== undefined) row.https = input.https;
    if (input.password) {
      row.passwordEnc = seal(input.password, this.config.getOrThrow<string>('jwt.secret'));
    } else if (input.password === null) {
      row.passwordEnc = null;
    }
    await this.devices.save(row);
    this.log.log('Терминалын холболтын тохиргоо шинэчлэв');
  }

  /** Олсон хаягийг DB-д бичнэ. Мөр байхгүй бол үүсгэнэ. */
  async remember(ip: string, info?: { model?: string; firmware?: string; serial?: string }): Promise<void> {
    const row = await this.devices.findOne({
      where: { active: true },
      order: { createdAt: 'ASC' },
    });
    if (row) {
      if (row.ip === ip && !info) return;
      row.ip = ip;
      if (info?.model) row.model = info.model;
      if (info?.firmware) row.firmware = info.firmware;
      row.online = true;
      row.lastSeenAt = new Date();
      await this.devices.save(row);
      this.log.log(`Терминалын хаяг шинэчлэв: ${ip}`);
      return;
    }
    await this.devices.save(
      this.devices.create({
        name: 'Гол хаалга',
        // ⚠ Сериал нь UNIQUE. Мэдэхгүй үед хаягаар түр нэрлэнэ —
        // дараагийн тулгалтад бодит сериалаар солигдоно.
        serial: info?.serial ?? `AUTO-${ip}`,
        model: info?.model ?? null,
        firmware: info?.firmware ?? null,
        ip,
        doorNo: this.config.get<number>('hikvision.doorNo') ?? 1,
        online: true,
        lastSeenAt: new Date(),
        active: true,
      }),
    );
    this.log.log(`Терминал бүртгэв: ${ip}`);
  }

  /**
   * Одоогийн төлөв — дэлгэцэд харуулах.
   *
   * ⚠ Нууц үгийг БУЦААХГҮЙ. Зөвхөн «тохируулсан эсэх» тугийг өгнө:
   * дэлгэцэд харуулбал browser-ийн санах ой, лог, screenshot-оор
   * тархана. Ажилтан солих бол шинийг нь бичнэ.
   */
  async current(): Promise<{
    ip: string | null;
    port: number;
    user: string;
    https: boolean;
    passwordSet: boolean;
    source: { ip: Src; port: Src; user: Src; password: Src };
    envHost: string | null;
    model: string | null;
    firmware: string | null;
    lastSeenAt: Date | null;
    subnet: string | null;
  }> {
    const row = await this.row();
    const envHost = this.config.get<string>('hikvision.host') || null;
    const envUser = this.config.get<string>('hikvision.user') || null;
    const envPass = this.config.get<string>('hikvision.password') || null;
    const src = (db: unknown, env: unknown): Src =>
      db != null && db !== '' ? 'db' : env != null && env !== '' ? 'env' : 'none';

    return {
      ip: row?.ip || envHost,
      port: row?.port ?? this.config.get<number>('hikvision.port') ?? 80,
      user: row?.username || envUser || 'admin',
      https: row?.https ?? this.config.get<boolean>('hikvision.https') ?? false,
      passwordSet: Boolean(row?.passwordEnc || envPass),
      source: {
        ip: src(row?.ip, envHost),
        port: src(row?.port, true),
        user: src(row?.username, envUser),
        password: src(row?.passwordEnc, envPass),
      },
      envHost,
      model: row?.model ?? null,
      firmware: row?.firmware ?? null,
      lastSeenAt: row?.lastSeenAt ?? null,
      subnet: this.localSubnet(),
    };
  }

  /** Энэ машины дэд сүлжээ, жишээ нь `192.168.0`. */
  localSubnet(): string | null {
    for (const list of Object.values(networkInterfaces())) {
      for (const n of list ?? []) {
        if (n.family === 'IPv4' && !n.internal) {
          return n.address.split('.').slice(0, 3).join('.');
        }
      }
    }
    return null;
  }

  /**
   * Дэд сүлжээнээс ISAPI хариулж буй хаягийг ХАЙНА.
   *
   * ⚠ НЭВТРЭХГҮЙ. Зөвхөн `401 + WWW-Authenticate: Digest` хариуг хардаг.
   * Тэр нь өөрөө «энэ бол Hikvision» гэсэн баталгаа бөгөөд буруу нууц
   * үгийн тоолуурыг ХӨДӨЛГӨХГҮЙ — 5 удаад төхөөрөмж IP-г 30 минут
   * блокдог тул энэ нь чухал.
   */
  async discover(subnetArg?: string): Promise<{
    subnet: string | null;
    found: string[];
    chosen: string | null;
  }> {
    const subnet = subnetArg ?? this.localSubnet();
    if (!subnet) return { subnet: null, found: [], chosen: null };

    this.log.log(`Терминал хайж байна: ${subnet}.1–254`);
    const found: string[] = [];
    // 32-оор багцална — 254-ийг зэрэг явуулбал сүлжээ боогдоно.
    for (let start = 1; start <= 254; start += 32) {
      const batch: Promise<string | null>[] = [];
      for (let i = start; i < start + 32 && i <= 254; i++) {
        batch.push(this.probe(`${subnet}.${i}`));
      }
      for (const ip of await Promise.all(batch)) if (ip) found.push(ip);
    }

    const chosen = found[0] ?? null;
    if (chosen) await this.remember(chosen);
    this.log.log(
      found.length
        ? `Олдлоо: ${found.join(', ')}`
        : 'Терминал олдсонгүй — сүлжээгээ шалгана уу',
    );
    return { subnet, found, chosen };
  }

  private async probe(ip: string): Promise<string | null> {
    try {
      const res = await fetch(`http://${ip}/ISAPI/System/deviceInfo`, {
        signal: AbortSignal.timeout(DeviceConnectionService.PROBE_MS),
      });
      const auth = res.headers.get('www-authenticate') ?? '';
      const server = res.headers.get('server') ?? '';
      const isapi =
        /digest/i.test(auth) || /hikvision|app-webs|dnvrs/i.test(server);
      return (res.status === 401 || res.status === 200) && isapi ? ip : null;
    } catch {
      return null;
    }
  }
}
