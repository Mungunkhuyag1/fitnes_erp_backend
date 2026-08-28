import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { networkInterfaces } from 'os';
import { Repository } from 'typeorm';
import { Device } from './device.entity';

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
export class DeviceAddressService {
  private readonly log = new Logger(DeviceAddressService.name);
  /** Сканнердах хугацаа — хэт богино бол алсын төхөөрөмж алдагдана. */
  private static readonly PROBE_MS = 1_200;

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly config: ConfigService,
  ) {}

  /** Одоо ашиглах хаяг. */
  async host(): Promise<string | null> {
    const row = await this.devices.findOne({
      where: { active: true },
      order: { createdAt: 'ASC' },
    });
    return row?.ip || this.config.get<string>('hikvision.host') || null;
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

  /** Одоогийн төлөв — дэлгэцэд харуулах. */
  async current(): Promise<{
    ip: string | null;
    source: 'db' | 'env' | 'none';
    envHost: string | null;
    model: string | null;
    firmware: string | null;
    lastSeenAt: Date | null;
    subnet: string | null;
  }> {
    const row = await this.devices.findOne({
      where: { active: true },
      order: { createdAt: 'ASC' },
    });
    const envHost = this.config.get<string>('hikvision.host') || null;
    return {
      ip: row?.ip || envHost,
      source: row?.ip ? 'db' : envHost ? 'env' : 'none',
      envHost,
      model: row?.model ?? null,
      firmware: row?.firmware ?? null,
      lastSeenAt: row?.lastSeenAt ?? null,
      subnet: this.localSubnet(),
    };
  }

  /**
   * Хаягийг ГАРААР тавих.
   *
   * Автомат хайлт бүтэлгүйтэх тохиолдол бий (өөр VLAN, сканнердахыг
   * хориглосон сүлжээ). Ажилтан router-ээс хаягийг олж мэддэг тул
   * шууд бичих зам ҮРГЭЛЖ байх ёстой.
   */
  async setManual(ip: string): Promise<void> {
    // ⚠ Хэлбэрийг шалгана: буруу утга орвол gateway бүх дуудлага дээр
    // унаж, шалтгаан нь тодорхойгүй болно.
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      throw new BadRequestException('IP хаяг буруу байна (жиш. 192.168.0.106)');
    }
    await this.remember(ip);
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
        signal: AbortSignal.timeout(DeviceAddressService.PROBE_MS),
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
