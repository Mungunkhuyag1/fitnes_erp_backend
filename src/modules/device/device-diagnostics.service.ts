import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { IsapiClient } from './isapi/isapi.client';

export interface DiagStep {
  key: string;
  label: string;
  /** Энэ алхам юуг батлах гэж байгаа — ажилтанд ойлгуулах. */
  why: string;
  ok: boolean;
  ms: number;
  /** ТҮҮХИЙ хариу. Таамаглахгүй — байгаагаар нь хадгална. */
  data?: unknown;
  error?: string;
}

export interface DiagResult {
  at: string;
  host: string;
  mode: string;
  steps: DiagStep[];
  ok: number;
  failed: number;
  /** Сервер дээр хадгалагдсан файлын зам (дараа ашиглах). */
  savedTo: string | null;
}

/**
 * Терминалын ISAPI оношилгоо — БҮХ хариуг түүхийгээр нь бүртгэнэ.
 *
 * ЯАГААД ТУСДАА ҮЙЛЧИЛГЭЭ ВЭ: `probe-device.ts` скрипт нь терминалын
 * дэргэд суусан хүн л ажиллуулж чадна. Фитнест очиход хамгийн хэрэгтэй
 * зүйл бол «юу ажиллаж, юу ажиллахгүй байна» гэдгийг ДЭЛГЭЦЭЭС харах.
 *
 * ⚠ Зөвхөн УНШИХ дуудлагууд. Хэрэглэгч үүсгэх, устгах, хаалга нээх
 * зэрэг бичих үйлдэл ЭНД БАЙХГҮЙ — оношилгоо нь терминалын төлөвийг
 * өөрчлөх ёсгүй.
 */
@Injectable()
export class DeviceDiagnosticsService {
  private readonly log = new Logger(DeviceDiagnosticsService.name);

  constructor(private readonly config: ConfigService) {}

  private client(): IsapiClient {
    const host = this.config.get<string>('hikvision.host');
    if (!host) {
      throw new ServiceUnavailableException(
        'HIK_HOST тохируулаагүй — .env дээр терминалын IP оруулна уу',
      );
    }
    return new IsapiClient({
      host,
      port: this.config.get<number>('hikvision.port'),
      user: this.config.getOrThrow<string>('hikvision.user'),
      password: this.config.getOrThrow<string>('hikvision.password'),
      https: this.config.get<boolean>('hikvision.https'),
      timeoutMs: 15_000,
    });
  }

  async run(opts: { employeeNo?: number; eventHours?: number } = {}): Promise<DiagResult> {
    const api = this.client();
    const employeeNo = opts.employeeNo ?? 1;
    const hours = Math.min(720, Math.max(1, opts.eventHours ?? 24));

    const defs: Omit<DiagStep, 'ok' | 'ms' | 'data' | 'error'>[] = [
      {
        key: 'deviceInfo',
        label: 'Төхөөрөмжийн мэдээлэл',
        why: 'Амьд эсэх, модель, firmware хувилбар',
      },
      {
        key: 'time',
        label: 'Цаг',
        why: 'Цаг зөрвөл эрх эрт/оройтож дуусна',
      },
      {
        key: 'capabilities',
        label: 'Боломжууд',
        why: 'Энэ firmware юу дэмждэг — таамаглахгүй',
      },
      {
        key: 'user',
        label: `Хэрэглэгч №${employeeNo}`,
        why: 'Хэрэглэгчийн хариуны БҮТЭЦ ямар байгааг харах',
      },
      {
        key: 'face',
        label: `Царай №${employeeNo}`,
        why: 'Царайн сан ажиллаж байгаа эсэх',
      },
      {
        key: 'events',
        label: `Сүүлийн ${hours} цагийн нэвтрэлт`,
        why: 'Ирц татах ажиллаж байгаа эсэх, эвентийн талбарууд',
      },
      {
        key: 'httpHosts',
        label: 'Эвент илгээх хаяг',
        why: 'Терминал push хийхээр тохируулагдсан эсэх',
      },
    ];

    const runners: Record<string, () => Promise<unknown>> = {
      deviceInfo: () => api.deviceInfo(),
      time: async () => {
        const t = await api.getTime();
        const skewSec = Math.round(
          Math.abs(Date.now() - new Date(t.localTime).getTime()) / 1000,
        );
        // Зөрүүг ТООЦООЛЖ өгнө — ажилтан толгойдоо бодох ёсгүй.
        return { ...t, skewSec, needsNtp: skewSec > 60 };
      },
      capabilities: () => api.capabilities(),
      user: () => api.searchUser(employeeNo),
      face: () => api.faceStatus([employeeNo]),
      events: async () => {
        const to = new Date();
        const from = new Date(to.getTime() - hours * 3600_000);
        return api.fetchEvents(from, to, 0, 20);
      },
      httpHosts: () => api.getHttpHosts(),
    };

    const steps: DiagStep[] = [];
    for (const def of defs) {
      const t0 = Date.now();
      try {
        const data = await runners[def.key]();
        steps.push({ ...def, ok: true, ms: Date.now() - t0, data });
      } catch (e) {
        steps.push({
          ...def,
          ok: false,
          ms: Date.now() - t0,
          error: (e as Error).message,
        });
        // ⚠ ЗОГСООХГҮЙ. Нэг дуудлага унасан нь бусад нь ажиллахгүй гэсэн
        // үг биш — firmware бүр өөр багц дэмждэг. Бүрэн зураг хэрэгтэй.
      }
    }

    const result: DiagResult = {
      at: new Date().toISOString(),
      host: this.config.get<string>('hikvision.host') ?? '',
      mode: this.config.get<string>('gateways.device') ?? 'direct',
      steps,
      ok: steps.filter((s) => s.ok).length,
      failed: steps.filter((s) => !s.ok).length,
      savedTo: null,
    };

    result.savedTo = await this.save(result);
    this.log.log(
      `Оношилгоо: ${result.ok} амжилттай, ${result.failed} унав → ${result.savedTo ?? 'хадгалаагүй'}`,
    );
    return result;
  }

  /**
   * Хариуг ФАЙЛД хадгална.
   *
   * Фитнест интернэт тасарч, эсвэл дэлгэц хаагдсан ч өгөгдөл үлдэнэ.
   * Дараа нь `docs/03-isapi-findings.md` бичихэд эх сурвалж болно.
   */
  private async save(r: DiagResult): Promise<string | null> {
    try {
      const dir = join(process.cwd(), 'probe');
      await mkdir(dir, { recursive: true });
      const name = `probe-${r.at.replace(/[:.]/g, '-')}.json`;
      const path = join(dir, name);
      await writeFile(path, JSON.stringify(r, null, 2), 'utf8');
      return path;
    } catch (e) {
      // Хадгалж чадаагүй нь оношилгоог унагаах шалтгаан биш —
      // дэлгэцэн дээрх үр дүн хэвээр хэрэгтэй.
      this.log.warn(`Оношилгоог хадгалж чадсангүй: ${(e as Error).message}`);
      return null;
    }
  }
}
