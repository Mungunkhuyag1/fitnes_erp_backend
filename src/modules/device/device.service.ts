import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { REASON_LABEL } from '../access/access.service';
import { DEVICE_GATEWAY, type DeviceGateway } from './device.gateway';
import { Device } from './device.entity';

/**
 * Терминалын ажиллагаа — ЗӨВХӨН төхөөрөмжтэй холбоотой.
 *
 * Гишүүн, төлбөр, шүүгээ энд хамаарахгүй. Ажилтан «терминал ажиллаж
 * байна уу, хэн орж чадаагүй вэ, яагаад» гэдгийг нэг дэлгэцээс хардаг.
 */
@Injectable()
export class DeviceService {
  private readonly log = new Logger(DeviceService.name);

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @Inject(DEVICE_GATEWAY) private readonly gateway: DeviceGateway,
    private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  list() {
    return this.devices.find({ order: { name: 'ASC' } });
  }

  /**
   * Терминалын үзүүлэлтүүд.
   *
   * `days` нь ХАМААРНА: уншуулалт, татгалзал, ачаалал бүгд тэр хугацаанд.
   * Царай, дараалал зэрэг нь ОДООГИЙН байдал тул хугацаанаас хамаарахгүй.
   */
  async stats(days = 7) {
    const tz = this.tz;
    const [row] = await this.ds.query<Record<string, string>[]>(
      `
      WITH today AS (
        SELECT date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1 AS start
      ), period AS (
        SELECT now() - ($2::text)::interval AS start
      )
      SELECT
        (SELECT count(*) FROM access_events, today WHERE event_at >= today.start) AS today_scans,
        (SELECT count(*) FROM access_events, today WHERE granted AND event_at >= today.start) AS today_granted,
        (SELECT count(*) FROM access_events, today WHERE NOT granted AND event_at >= today.start) AS today_denied,
        (SELECT count(*) FROM access_events, period WHERE event_at >= period.start) AS scans,
        (SELECT count(*) FROM access_events, period WHERE granted AND event_at >= period.start) AS granted,
        (SELECT count(*) FROM access_events, period WHERE NOT granted AND event_at >= period.start) AS denied,
        -- Царай бүртгэл: терминал хүнийг таних боломжтой эсэх
        (SELECT count(*) FROM members WHERE face_enrolled AND status <> 'cancelled') AS face_ok,
        (SELECT count(*) FROM members WHERE NOT face_enrolled AND status <> 'cancelled') AS face_missing,
        -- Терминал руу бичих дараалал
        (SELECT count(*) FROM outbox WHERE topic LIKE 'hik.%' AND status = 'pending') AS queue_pending,
        (SELECT count(*) FROM outbox WHERE topic LIKE 'hik.%' AND status = 'failed')  AS queue_failed,
        (SELECT count(*) FROM members WHERE hik_sync_error IS NOT NULL) AS sync_errors,
        (SELECT max(hik_synced_at) FROM members) AS last_sync_at
      `,
      [tz, `${days} days`],
    );
    const n = (k: string): number => Number(row[k] ?? 0);

    const [reasons, hourly, daily, devices] = await Promise.all([
      // Татгалзсан шалтгаан — ажилтны хийх зүйл ЭНДЭЭС тодорхойлогдоно.
      this.ds.query<{ reason: string; c: string }[]>(
        `SELECT reason, count(*) AS c FROM access_events
         WHERE NOT granted AND event_at >= now() - ($1::text)::interval
         GROUP BY 1 ORDER BY c DESC`,
        [`${days} days`],
      ),
      this.ds.query<{ h: string; c: string }[]>(
        `SELECT extract(hour FROM event_at AT TIME ZONE $1)::int AS h, count(*) AS c
         FROM access_events WHERE event_at >= now() - ($2::text)::interval
         GROUP BY 1 ORDER BY 1`,
        [tz, `${days} days`],
      ),
      this.ds.query<{ d: string; scans: string; denied: string }[]>(
        `WITH days AS (
           SELECT generate_series(
             (date_trunc('day', now() AT TIME ZONE $1) - (($2 - 1)::text || ' days')::interval)::date,
             (date_trunc('day', now() AT TIME ZONE $1))::date,
             interval '1 day')::date AS d
         )
         SELECT days.d::text AS d,
           coalesce((SELECT count(*) FROM access_events e
             WHERE (e.event_at AT TIME ZONE $1)::date = days.d), 0) AS scans,
           coalesce((SELECT count(*) FROM access_events e
             WHERE NOT e.granted AND (e.event_at AT TIME ZONE $1)::date = days.d), 0) AS denied
         FROM days ORDER BY days.d`,
        [tz, days],
      ),
      this.devices.find({ order: { name: 'ASC' } }),
    ]);

    return {
      mode: this.config.get<string>('gateways.device'),
      today: {
        scans: n('today_scans'),
        granted: n('today_granted'),
        denied: n('today_denied'),
      },
      period: {
        days,
        scans: n('scans'),
        granted: n('granted'),
        denied: n('denied'),
      },
      faces: { enrolled: n('face_ok'), missing: n('face_missing') },
      queue: {
        pending: n('queue_pending'),
        failed: n('queue_failed'),
        memberErrors: n('sync_errors'),
        lastSyncAt: row.last_sync_at ?? null,
      },
      denialReasons: reasons.map((r) => ({
        reason: r.reason,
        label: REASON_LABEL[r.reason] ?? r.reason,
        count: Number(r.c),
      })),
      hourly: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        scans: Number(hourly.find((x) => Number(x.h) === h)?.c ?? 0),
      })),
      daily: daily.map((d) => ({
        date: d.d,
        scans: Number(d.scans),
        denied: Number(d.denied),
      })),
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        model: d.model,
        ip: d.ip,
        firmware: d.firmware,
        doorNo: d.doorNo,
        online: d.online,
        active: d.active,
        lastSeenAt: d.lastSeenAt,
      })),
    };
  }

  /** Терминалтай ЯРЬЖ үзэх — холболт, эрх, цагийг шалгана. */
  async ping() {
    try {
      const info = await this.gateway.info();
      return { ok: true, info };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  /** Хаалгыг зайнаас нээх — аудитад бичигдэнэ (controller дээр). */
  async openDoor(id: string) {
    const device = await this.devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Терминал олдсонгүй');
    await this.gateway.openDoor(device.doorNo);
    this.log.warn(`Хаалга зайнаас нээв: ${device.name}`);
    return { ok: true };
  }
}
