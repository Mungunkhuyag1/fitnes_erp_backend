import { Logger } from '@nestjs/common';
import { DigestAuthError, DigestClient } from './digest';

export interface IsapiConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  https?: boolean;
  timeoutMs?: number;
}

/** Терминал хариу өгсөн ч алдаа буцаасан (ISAPI-ийн статус). */
export class IsapiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message?: string,
  ) {
    super(message ?? `ISAPI ${status}: ${body.slice(0, 200)}`);
    this.name = 'IsapiError';
  }
}

/** Терминал дээр тухайн хэрэглэгч байхгүй. */
export class IsapiUserNotFound extends Error {
  constructor(readonly employeeNo: number) {
    super(`Терминал дээр ${employeeNo} дугаартай хэрэглэгч байхгүй`);
    this.name = 'IsapiUserNotFound';
  }
}

interface Json {
  [k: string]: unknown;
}

/**
 * Hikvision ISAPI клиент.
 *
 * `direct` (нэг LAN) ба `agent` (on-prem) хоёулаа ЭНЭ клиентийг ашиглана —
 * ISAPI-ийн логик нэг л газарт бичигдэнэ.
 *
 * ⚠ Firmware хооронд endpoint/талбарын нэр ЗӨРДӨГ. Тиймээс:
 *   • `capabilities()`-ыг эхэлж дуудаж юу дэмждэгийг мэдэх
 *   • Хариуг түүхийгээр нь логлож, mapping-ыг бодит өгөгдлөөс тогтоох
 *   Дэлгэрэнгүй: docs/03-isapi-findings.md (газар дээр туршсаны дараа)
 */
export class IsapiClient {
  private readonly log = new Logger(IsapiClient.name);
  private readonly http: DigestClient;

  constructor(private readonly cfg: IsapiConfig) {
    const scheme = cfg.https ? 'https' : 'http';
    const port = cfg.port ?? (cfg.https ? 443 : 80);
    this.http = new DigestClient(`${scheme}://${cfg.host}:${port}`, {
      user: cfg.user,
      password: cfg.password,
      timeoutMs: cfg.timeoutMs,
    });
  }

  get address(): string {
    return `${this.cfg.host}:${this.cfg.port ?? 80}`;
  }

  // ══════════════════════════════════════════════════════════════
  //  Үндсэн
  // ══════════════════════════════════════════════════════════════

  /** Төхөөрөмжийн мэдээлэл — амьд эсэх, firmware. XML буцаана. */
  async deviceInfo(): Promise<{ model: string; firmware: string; raw: string }> {
    const { status, text } = await this.http.request(
      'GET',
      '/ISAPI/System/deviceInfo',
    );
    if (status !== 200) throw new IsapiError(status, text);
    return {
      model: this.xmlValue(text, 'model') ?? 'unknown',
      firmware: this.xmlValue(text, 'firmwareVersion') ?? 'unknown',
      raw: text,
    };
  }

  /**
   * Энэ firmware юу дэмждэг вэ.
   *
   * Таамаглахын оронд төхөөрөмжөөс АСУУНА — endpoint байгаа эсэхийг урьдчилан
   * мэдэж, `404`-ээр гайхахгүй.
   */
  async capabilities(): Promise<{ system: string; accessControl: string }> {
    const [sys, acs] = await Promise.all([
      this.http.request('GET', '/ISAPI/System/capabilities'),
      this.http.request('GET', '/ISAPI/AccessControl/capabilities?format=json'),
    ]);
    return { system: sys.text, accessControl: acs.text };
  }

  /** Терминалын цаг. Зөрвөл эрх эрт/оройтож дуусна. */
  async getTime(): Promise<{ localTime: string; timeZone: string; raw: string }> {
    const { status, text } = await this.http.request('GET', '/ISAPI/System/time');
    if (status !== 200) throw new IsapiError(status, text);
    return {
      localTime: this.xmlValue(text, 'localTime') ?? '',
      timeZone: this.xmlValue(text, 'timeZone') ?? '',
      raw: text,
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  Хэрэглэгч
  // ══════════════════════════════════════════════════════════════

  async searchUser(employeeNo: number): Promise<Json | null> {
    const body = JSON.stringify({
      UserInfoSearchCond: {
        searchID: `winfit-${employeeNo}`,
        searchResultPosition: 0,
        maxResults: 1,
        EmployeeNoList: [{ employeeNo: String(employeeNo) }],
      },
    });
    const { status, text } = await this.json(
      'POST',
      '/ISAPI/AccessControl/UserInfo/Search?format=json',
      body,
    );
    if (status !== 200) throw new IsapiError(status, text);
    const parsed = this.parse(text);
    const search = parsed.UserInfoSearch as Json | undefined;
    const list = search?.UserInfo as Json[] | undefined;
    return list?.length ? list[0] : null;
  }

  /**
   * БҮХ хэрэглэгчийг хуудаслан татна.
   *
   * ⚠ `totalMatches` нь ЭХНИЙ хуудсанд л ирдэг тул түүнийг барьж авч
   * дуустал давтана. Мөн `maxResults` нь firmware-ээс хамааран
   * хязгаартай — 30-аар багцлах нь бүх хувилбар дээр найдвартай.
   *
   * ⚠ Энэ нь ХҮНД дуудлага (337 хэрэглэгч ≈ 12 хүсэлт). Ойрхон
   * давтвал терминал удаашрах тул зөвхөн шөнийн тулгалтад хэрэглэнэ.
   */
  async listUsers(): Promise<Json[]> {
    const users: Json[] = [];
    let pos = 0;
    let total = 0;
    for (;;) {
      const body = JSON.stringify({
        UserInfoSearchCond: {
          searchID: 'winfit-audit',
          searchResultPosition: pos,
          maxResults: 30,
        },
      });
      const { status, text } = await this.json(
        'POST',
        '/ISAPI/AccessControl/UserInfo/Search?format=json',
        body,
      );
      if (status !== 200) throw new IsapiError(status, text);
      const search = (this.parse(text).UserInfoSearch ?? {}) as Json;
      total = (search.totalMatches as number) ?? total;
      const batch = (search.UserInfo as Json[]) ?? [];
      users.push(...batch);
      if (!batch.length || users.length >= total) break;
      pos += batch.length;
    }
    return users;
  }

  /**
   * Хэрэглэгч үүсгэх / шинэчлэх.
   *
   * ISAPI-д `Record` (шинэ) ба `Modify` (байгаа) тусдаа тул эхлээд хайж
   * үзнэ. Ингэснээр давхар үүсгэх, эсвэл байхгүй дээр Modify хийх алдаа
   * гарахгүй — дуудагч тал идемпотент байдлыг мэдрэхгүй.
   */
  async upsertUser(input: {
    employeeNo: number;
    name: string;
    beginTime: string;
    endTime: string;
    enable: boolean;
    doorNo?: number;
    planTemplateNo?: string;
  }): Promise<'created' | 'updated'> {
    const payload = {
      UserInfo: {
        employeeNo: String(input.employeeNo),
        name: input.name,
        userType: 'normal',
        Valid: {
          enable: input.enable,
          beginTime: input.beginTime,
          endTime: input.endTime,
          timeType: 'local',
        },
        doorRight: String(input.doorNo ?? 1),
        RightPlan: [
          {
            doorNo: input.doorNo ?? 1,
            planTemplateNo: input.planTemplateNo ?? '1',
          },
        ],
      },
    };

    const existing = await this.searchUser(input.employeeNo);
    const path = existing
      ? '/ISAPI/AccessControl/UserInfo/Modify?format=json'
      : '/ISAPI/AccessControl/UserInfo/Record?format=json';
    const method = existing ? 'PUT' : 'POST';

    const { status, text } = await this.json(method, path, JSON.stringify(payload));
    if (status !== 200) throw new IsapiError(status, text);
    this.assertOk(text);
    return existing ? 'updated' : 'created';
  }

  /** Зөвхөн хугацаа/идэвхийг өөрчлөх. Хэрэглэгч байхгүй бол алдаа. */
  async setValidity(input: {
    employeeNo: number;
    name: string;
    beginTime: string;
    endTime: string;
    enable: boolean;
    doorNo?: number;
    planTemplateNo?: string;
  }): Promise<void> {
    const existing = await this.searchUser(input.employeeNo);
    if (!existing) throw new IsapiUserNotFound(input.employeeNo);

    const { status, text } = await this.json(
      'PUT',
      '/ISAPI/AccessControl/UserInfo/Modify?format=json',
      JSON.stringify({
        UserInfo: {
          employeeNo: String(input.employeeNo),
          // ⚠ Modify нь бүтэн обьект хүлээдэг — `name` дутвал устгагдаж болно.
          name: input.name,
          Valid: {
            enable: input.enable,
            beginTime: input.beginTime,
            endTime: input.endTime,
            timeType: 'local',
          },
          doorRight: String(input.doorNo ?? 1),
          RightPlan: [
            {
              doorNo: input.doorNo ?? 1,
              planTemplateNo: input.planTemplateNo ?? '1',
            },
          ],
        },
      }),
    );
    if (status !== 200) throw new IsapiError(status, text);
    this.assertOk(text);
  }

  async deleteUser(employeeNo: number): Promise<void> {
    const { status, text } = await this.json(
      'PUT',
      '/ISAPI/AccessControl/UserInfo/Delete?format=json',
      JSON.stringify({
        UserInfoDelCond: {
          EmployeeNoList: [{ employeeNo: String(employeeNo) }],
        },
      }),
    );
    // Байхгүйг устгах нь алдаа биш — идемпотент.
    if (status === 200) return;
    throw new IsapiError(status, text);
  }

  // ══════════════════════════════════════════════════════════════
  //  Царай
  // ══════════════════════════════════════════════════════════════

  /** Заасан хүмүүсийн царай бүртгэгдсэн эсэх. */
  async faceStatus(employeeNos: number[]): Promise<Record<number, boolean>> {
    const out: Record<number, boolean> = {};
    for (const no of employeeNos) {
      const { status, text } = await this.json(
        'POST',
        '/ISAPI/Intelligent/FDLib/FDSearch?format=json',
        JSON.stringify({
          searchResultPosition: 0,
          maxResults: 1,
          faceLibType: 'blackFD',
          FDID: '1',
          FPID: String(no),
        }),
      );
      if (status !== 200) {
        out[no] = false;
        continue;
      }
      const parsed = this.parse(text);
      const total = Number(parsed.totalMatches ?? parsed.numOfMatches ?? 0);
      out[no] = total > 0;
    }
    return out;
  }

  // ══════════════════════════════════════════════════════════════
  //  Хаалга / эвент
  // ══════════════════════════════════════════════════════════════

  async openDoor(doorNo = 1): Promise<void> {
    const { status, text } = await this.http.request(
      'PUT',
      `/ISAPI/AccessControl/RemoteControl/door/${doorNo}`,
      '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>',
      { 'Content-Type': 'application/xml' },
    );
    if (status !== 200) throw new IsapiError(status, text);
  }

  /**
   * Нэвтрэлтийн эвент татах.
   *
   * Push (HTTP Listening) алдагдсаныг нөхөх ба agent асахад ГҮЙЦЭЭХ горимд
   * ашиглана (docs/04-agent-design.md §6.1).
   */
  async fetchEvents(
    from: Date,
    to: Date,
    position = 0,
    max = 100,
  ): Promise<{ events: Json[]; total: number; raw: string }> {
    const { status, text } = await this.json(
      'POST',
      '/ISAPI/AccessControl/AcsEvent?format=json',
      JSON.stringify({
        AcsEventCond: {
          searchID: 'winfit-events',
          searchResultPosition: position,
          maxResults: max,
          major: 0,
          minor: 0,
          startTime: this.isoLocal(from),
          endTime: this.isoLocal(to),
        },
      }),
    );
    if (status !== 200) throw new IsapiError(status, text);
    const parsed = this.parse(text);
    const acs = parsed.AcsEvent as Json | undefined;
    return {
      events: (acs?.InfoList as Json[]) ?? [],
      total: Number(acs?.totalMatches ?? 0),
      raw: text,
    };
  }

  /** Эвентийг илгээх хаяг (HTTP Listening) — одоогийн тохиргоог унших. */
  async getHttpHosts(): Promise<string> {
    const { text } = await this.http.request(
      'GET',
      '/ISAPI/Event/notification/httpHosts',
    );
    return text;
  }

  // ══════════════════════════════════════════════════════════════
  //  Туслах
  // ══════════════════════════════════════════════════════════════

  /**
   * Түүхий ISAPI дуудлага — экспорт, оношилгоонд.
   *
   * ⚠ Хуудаслалт шаардсан дуудлагад л хэрэглэнэ (`UserInfo/Search`).
   * Ердийн үйлдэлд ДЭЭРХ нэрлэсэн методуудыг ашиглана: тэдгээр нь
   * хариуны бүтцийг шалгаж, алдааг ангилдаг.
   */
  async raw<T = Json>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const { status, text } = await this.json(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
    );
    if (status !== 200) throw new IsapiError(status, text);
    return this.parse(text) as T;
  }

  private json(method: string, path: string, body?: string) {
    return this.http.request(method, path, body, {
      'Content-Type': 'application/json',
    });
  }

  private parse(text: string): Json {
    try {
      return JSON.parse(text) as Json;
    } catch {
      return {};
    }
  }

  /** ISAPI-ийн `statusCode` шалгах (200 HTTP ч дотроо алдаатай байж болно). */
  private assertOk(text: string): void {
    const j = this.parse(text);
    const code = Number(j.statusCode ?? 1);
    if (code !== 1 && code !== 0) {
      throw new IsapiError(
        200,
        text,
        `ISAPI статус ${code}: ${String(j.statusString ?? j.subStatusCode ?? '')}`,
      );
    }
  }

  private xmlValue(xml: string, tag: string): string | null {
    const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
    return m ? m[1] : null;
  }

  /**
   * Hikvision нь ЛОКАЛ цагаар ажилладаг: `2026-08-24T09:00:00`.
   * UTC илгээвэл эрх хэдэн цагаар зөрнө.
   */
  private isoLocal(d: Date): string {
    const tz = process.env.TZ ?? 'Asia/Ulaanbaatar';
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const g = (t: string): string => p.find((x) => x.type === t)?.value ?? '00';
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`;
  }
}

export { DigestAuthError };
