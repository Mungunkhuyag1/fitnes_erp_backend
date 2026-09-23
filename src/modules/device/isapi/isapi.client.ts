import { Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DigestAuthError, DigestClient } from './digest';

export interface IsapiConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  https?: boolean;
  timeoutMs?: number;
  /** Cloudflare Access гэх мэт урд байгаа хамгаалалтын толгой. */
  headers?: Record<string, string>;
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
  constructor(readonly employeeNo: string) {
    super(`Терминал дээр ${employeeNo} дугаартай хэрэглэгч байхгүй`);
    this.name = 'IsapiUserNotFound';
  }
}

/**
 * Терминал царай ОЛСОНГҮЙ — хүн ирсэнгүй, эсвэл буруу зогссон.
 *
 * ⚠ Энэ нь ЭВДРЭЛ БИШ, ердийн үр дүн: ажилтан дахин дарахад л
 * болно. Тиймээс тусад нь ангилж, дэлгэц дээр «дахин оролдоно уу»
 * гэж хэлнэ — «терминал холбогдсонгүй» гэсэн худал мэдээлэл биш.
 */
export class IsapiFaceCaptureTimeout extends Error {
  constructor(message = 'Царай олдсонгүй — терминалын өмнө зогсож дахин оролдоно уу') {
    super(message);
    this.name = 'IsapiFaceCaptureTimeout';
  }
}

/**
 * Терминал царайг БАРЬСАН ч хүлээж АВСАНГҮЙ.
 *
 * Гэрэл муу, нүүр жижиг, өнцөг ташуу, нүдний шил гэрэлтсэн. Заалны
 * нөхцөлд хамгийн олон тохиолддог үр дүн.
 *
 * ⚠ Үүнийг холболтын алдаанаас ЗААВАЛ ялгана. «Терминалтай холбогдож
 * чадсангүй» гэж хэлбэл ажилтан сүлжээ шалгаж, тунелээ дахин асааж,
 * эцэст нь гишүүнээ буцаана — асуудал нь зүгээр л гэрэлтүүлэг байхад.
 */
export class IsapiFaceRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsapiFaceRejected';
  }
}

import { terminalPath } from './terminal-path';
import type { FaceInfo } from '../device.gateway';

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
      defaultHeaders: cfg.headers,
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

  async searchUser(employeeNo: string): Promise<Json | null> {
    const body = JSON.stringify({
      UserInfoSearchCond: {
        searchID: `winfit-${employeeNo}`,
        searchResultPosition: 0,
        maxResults: 1,
        EmployeeNoList: [{ employeeNo }],
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
    employeeNo: string;
    name: string;
    beginTime: string;
    endTime: string;
    enable: boolean;
    doorNo?: number;
    planTemplateNo?: string;
  }): Promise<'created' | 'updated'> {
    const payload = {
      UserInfo: {
        employeeNo: input.employeeNo,
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
    employeeNo: string;
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
          employeeNo: input.employeeNo,
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

  /*
   * ⚠ `deleteUser` ЭНД БАЙХГҮЙ — ЗОРИУД.
   *
   * `PUT /ISAPI/AccessControl/UserInfo/Delete` нь `EmployeeNoList`
   * БАЙХГҮЙ үед терминалын БҮХ хэрэглэгчийг арилгадаг. Нэг алдаатай
   * дуудлага заалны 338 гишүүнийг царайтай нь хамт устгана — терминал
   * нөөцгүй.
   *
   * WinFit терминалаас хэзээ ч устгахгүй. Эрх хаах бол `setValidity`.
   */


  // ══════════════════════════════════════════════════════════════
  //  Царай
  // ══════════════════════════════════════════════════════════════

  /** Заасан хүмүүсийн царай бүртгэгдсэн эсэх. */
  /**
   * Царай бүртгэгдсэн эсэх БА зургийн зам.
   *
   * `FDSearch` нь тааралтын жагсаалтад `faceURL`-ыг хамт буцаадаг тул
   * тусад нь дахин хүсэлт явуулах шаардлагагүй.
   */
  async faceStatus(employeeNos: string[]): Promise<Record<string, FaceInfo>> {
    const out: Record<string, FaceInfo> = {};
    for (const no of employeeNos) {
      const { status, text } = await this.json(
        'POST',
        '/ISAPI/Intelligent/FDLib/FDSearch?format=json',
        JSON.stringify({
          searchResultPosition: 0,
          maxResults: 1,
          faceLibType: 'blackFD',
          FDID: '1',
          FPID: no,
        }),
      );
      if (status !== 200) {
        out[no] = { enrolled: false, path: null };
        continue;
      }
      const parsed = this.parse(text);
      const total = Number(parsed.totalMatches ?? parsed.numOfMatches ?? 0);
      const list = parsed.MatchList;
      const first =
        Array.isArray(list) && list.length
          ? (list[0] as Record<string, unknown>)
          : null;
      out[no] = {
        enrolled: total > 0,
        // ⚠ Зөвхөн ЗАМ. Терминалын хаяг нь хариунд байдаг ч хадгалахгүй.
        path: terminalPath(
          typeof first?.faceURL === 'string' ? first.faceURL : null,
        ),
      };
    }
    return out;
  }

  /**
   * Царай уншуулах бүтэн урсгал: барих → санд бичих → баталгаажуулах.
   *
   * ★ ГУРВАН АЛХАМ, ГУРВАН ӨӨР ISAPI
   *
   *  1. `CaptureFaceData`  — терминал дэлгэцээ асааж камераараа барина
   *  2. `FaceDataRecord`   — барьсан зургийг тухайн хүний нэр дээр бичнэ
   *  3. `FDSearch`         — үнэхээр орсон эсэхийг ТЕРМИНАЛААС асууна
   *
   * ★ ЯАГААД 3 ДАХЬ АЛХАМ ХЭРЭГТЭЙ ВЭ
   *
   * 2-р алхам `200 OK` буцаасан ч терминал зургийг хүлээж аваагүй
   * байж болно (чанар муу, нүүр жижиг). Асуухгүй бол WinFit «бүртгэгдлээ»
   * гэж бичээд, хүн маргааш хаалган дээр зогсоно.
   *
   * ⚠ ЭНЭ ШАЛГАЛТЫН ХЯЗГААР: ДАХИН уншуулахад `enrolled` нь ХУУЧИН
   * царайгаар ч үнэн гарна. Өөрөөр хэлбэл «шинэ зураг солигдсон уу»
   * гэдгийг батлахгүй, зөвхөн «царай байгаа юу» гэдгийг. Терминал нь
   * зургийн файлын нэрийг ижилхэн үлдээдэг тул замаар нь ч ялгах
   * боломжгүй. Шинээр бүртгэх үед (гол хэрэглээ) шалгалт бүрэн зөв.
   */
  async enrollFace(
    employeeNo: string,
    waitMs = 60_000,
  ): Promise<FaceInfo> {
    const jpeg = await this.captureFace(waitMs);
    await this.putFace(employeeNo, jpeg);
    const status = await this.faceStatus([employeeNo]);
    const info = status[employeeNo] ?? { enrolled: false, path: null };
    if (!info.enrolled) {
      /*
       * ⚠ Энэ нь ХОЛБОЛТЫН алдаа БИШ — терминал хариулсан, зөвхөн
       * зургийг нь хүлээж аваагүй. Иймд «дахин оролдох» ангилалд
       * оруулна: заалны гэрэлтүүлэг муу, хүн хол зогссон гэх мэт
       * шалтгаан нь фитнес дээр ХАМГИЙН ОЛОН тохиолдоно.
       */
      throw new IsapiFaceRejected(
        'Терминал зургийг хүлээж авсангүй — гэрэлтүүлэг, өнцгөө засаж дахин оролдоно уу',
      );
    }
    return info;
  }

  /**
   * Терминалын камераар царай БАРИХ (алсын цуглуулга).
   *
   * ★ ЭНЭ НЬ УДААН ДУУДЛАГА
   *
   * Терминал хүн ойртохыг хүлээнэ. Тиймээс:
   *   • `timeoutMs` нь энэ хүсэлтэд тусгайлан УРТ
   *   • firmware хэсэгчилсэн явцыг (`captureProgress < 100`) буцаавал
   *     дахин асууна — нэг хариугаар шийдвэл хүн ойртож амжаагүй үед
   *     «олдсонгүй» гэж буруу дүгнэнэ
   *
   * ⚠ Хариуны БҮТЭЦ firmware хооронд зөрдөг. Тиймээс эхний хариуг
   * түүхийгээр `debug` түвшинд логлоно — газар дээр нэг удаа ажиллуулж
   * харснаар цаашдын засвар хурдан болно.
   */
  async captureFace(waitMs = 60_000): Promise<Buffer> {
    const deadline = Date.now() + waitMs;
    // Нэг оролдлогод терминалд өгөх хугацаа. Cloudflare tunnel нь
    // origin-ийн хариуг ~100 сек хүлээдэг тул түүнээс доогуур барина.
    const perTry = Math.min(30_000, Math.max(10_000, waitMs));
    let logged = false;

    for (;;) {
      /*
       * ⚠ Хугацааг ОРОЛДОХЫН ӨМНӨ шалгана.
       *
       * Дараа нь шалгавал 59.9 дэх секундэд шинэ оролдлого эхэлж,
       * 35 секунд үргэлжилнэ. Түүн дээр зураг илгээх (30с) ба
       * баталгаажуулах (15с) нэмэгдэж, нийт хүсэлт 100 секундээс
       * давна — Cloudflare тунел яг тэнд таслаад 524 буцаана.
       */
      if (Date.now() >= deadline) throw new IsapiFaceCaptureTimeout();

      const { status, text } = await this.http.request(
        'POST',
        '/ISAPI/AccessControl/CaptureFaceData',
        '<CaptureFaceDataCond version="2.0">' +
          '<captureInfrared>false</captureInfrared>' +
          '<dataType>url</dataType>' +
          '</CaptureFaceDataCond>',
        { 'Content-Type': 'application/xml' },
        { timeoutMs: perTry + 5_000 },
      );

      /*
       * ⚠ `log`, `debug` БИШ — production дээр Nest нь `debug`-ийг
       * ХАЯДАГ. Газар дээрх АНХНЫ ажиллагаа бол энэ хариуны бүтцийг
       * харах цорын ганц боломж: `capabilities`-д схем нь байдаггүй
       * тул firmware юу буцаахыг урьдчилан мэдэх арга үгүй. Харагдахгүй
       * бол дахин таамаглахаас өөр зүйл үлдэхгүй.
       *
       * Уншуулалт бүрд НЭГ л удаа бичигдэнэ — лог дүүргэхгүй.
       */
      if (!logged) {
        logged = true;
        this.log.log(`CaptureFaceData хариу (${status}): ${text.slice(0, 500)}`);
      }
      if (status !== 200) throw new IsapiError(status, text);

      const url = this.xmlValue(text, 'faceDataUrl');
      if (url) {
        const path = terminalPath(url);
        if (!path) {
          throw new IsapiError(200, text, `Барьсан зургийн зам танигдсангүй: ${url}`);
        }
        const img = await this.http.requestBytes('GET', path);
        if (img.status !== 200 || !img.bytes.length) {
          throw new IsapiError(img.status, '', 'Барьсан зургийг татаж чадсангүй');
        }
        return img.bytes;
      }

      /*
       * Явц 100 хүрсэн ч хаяг алга = терминал царай ОЛООГҮЙ.
       * Явц 100-аас бага бол хүлээсээр байна — дахин асууна.
       */
      const raw = this.xmlValue(text, 'captureProgress');

      /*
       * ⚠ ХАЯГ Ч АЛГА, ЯВЦ Ч АЛГА = энэ firmware `dataType=url`-ыг
       * ТАНИХГҮЙ байна.
       *
       * Үүнийг «царай олдсонгүй» гэж үзвэл минут хүлээгээд буруу
       * шалтгаан хэлнэ: ажилтан гишүүнээ дахин дахин зогсоож,
       * асуудал нь firmware-т байгааг хэзээ ч мэдэхгүй. Тиймээс
       * ШУУД унаж, түүхий хариуг үлдээнэ.
       */
      if (raw === null) {
        throw new IsapiError(
          status,
          text,
          'Терминал царай барих хүсэлтийг танихгүй байна (firmware дэмжихгүй байж магадгүй)',
        );
      }

      const progress = Number(raw);
      if (progress >= 100 || Date.now() >= deadline) {
        throw new IsapiFaceCaptureTimeout();
      }
      // Терминалыг хүсэлтээр дарахгүй — хүн ойртоход хэдэн секунд хэрэгтэй.
      await new Promise((r) => setTimeout(r, 1_500));
    }
  }

  /**
   * Барьсан зургийг тухайн хүний царайн бүртгэл болгон хадгална.
   *
   * ★ ХОЁР ӨӨР ENDPOINT — firmware-ээс ХАМААРНА
   *
   * Hikvision нь `FaceDataRecord` (нэмэх) ба `FDSetUp` (засах) гэж
   * хоёр замтай бөгөөд аль нь ажиллах нь хувилбараас хамаарна. Аль
   * нэг нь 4xx буцаавал нөгөөг нь оролдоно — эс бөгөөс өөр firmware
   * дээр чимээгүй ажиллахаа болино.
   *
   * ⚠ `FPID` нь `employeeNo` — `faceStatus` хайхдаа ижил түлхүүр
   * ашигладаг. Өөр утга бичвэл зураг орох ч «бүртгэгдээгүй» харагдана.
   */
  private async putFace(employeeNo: string, jpeg: Buffer): Promise<void> {
    const attempts: { method: string; path: string }[] = [
      { method: 'POST', path: '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json' },
      { method: 'PUT', path: '/ISAPI/Intelligent/FDLib/FDSetUp?format=json' },
    ];

    let last: IsapiError | null = null;
    for (const a of attempts) {
      const boundary = `----winfit${randomBytes(12).toString('hex')}`;
      const body = this.faceMultipart(boundary, employeeNo, jpeg);
      const { status, text } = await this.http.requestBinary(
        a.method,
        a.path,
        body,
        { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        // Зураг илгээх нь ~100КБ — сүлжээ удаан бол 15 сек хүрэлцэхгүй.
        { timeoutMs: 30_000 },
      );
      if (status === 200) {
        try {
          this.assertOk(text);
          this.log.log(`Царай бичигдэв (${a.path}): №${employeeNo}`);
          return;
        } catch (e) {
          last = e instanceof IsapiError ? e : new IsapiError(200, text);
        }
      } else {
        last = new IsapiError(status, text);
      }
      this.log.debug(`${a.path} бүтсэнгүй (${status}) — дараагийнхыг оролдоно`);
    }
    throw last ?? new IsapiError(0, '', 'Царай бичигдсэнгүй');
  }

  /** Hikvision-ий хүлээдэг `multipart/form-data` биеийг угсарна. */
  private faceMultipart(
    boundary: string,
    employeeNo: string,
    jpeg: Buffer,
  ): Buffer {
    const meta = JSON.stringify({
      faceLibType: 'blackFD',
      FDID: '1',
      FPID: employeeNo,
    });
    return Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="FaceDataRecord";\r\n' +
          'Content-Type: application/json\r\n' +
          `Content-Length: ${Buffer.byteLength(meta)}\r\n\r\n` +
          `${meta}\r\n`,
        'utf8',
      ),
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="img"; filename="face.jpg"\r\n' +
          'Content-Type: image/jpeg\r\n' +
          `Content-Length: ${jpeg.length}\r\n\r\n`,
        'utf8',
      ),
      jpeg,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);
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
    /*
     * ★ `picEnable` — ЗУРГИЙН ХАЯГ АВАХ ТүЛХҮҮР.
     *
     * Энэ талбаргүй бол олон firmware хариундаа `pictureURL`-ыг
     * ОГТ өгдөггүй. Түлхэлт нь хаяг илгээдэггүй тул энэ нь
     * ирцийн кадрыг авах ЦОРЫН ГАНЦ зам.
     *
     * ⚠ Зарим firmware танихгүй талбарт алдаа өгдөг. Тэр үед
     *   ИРЦ ТАТАХ БҮХЭЛДЭЭ ЗОГСОХ ёсгүй — зураг нь таатай зүйл,
     *   ирц нь зайлшгүй. Тиймээс алдаа өгвөл АНХНЫ хэлбэрээр
     *   дахин оролдоно.
     */
    const cond = (pic: boolean): string =>
      JSON.stringify({
        AcsEventCond: {
          searchID: 'winfit-events',
          searchResultPosition: position,
          maxResults: max,
          major: 0,
          minor: 0,
          startTime: this.isoLocal(from),
          endTime: this.isoLocal(to),
          ...(pic ? { picEnable: true } : {}),
        },
      });

    const path = '/ISAPI/AccessControl/AcsEvent?format=json';
    let { status, text } = await this.json('POST', path, cond(true));
    if (status !== 200) {
      // Чимээгүй буцахгүй: зураг хэзээ ч ирэхгүй шалтгааныг хэлнэ.
      this.log.warn(
        `Эвент татахад терминал «picEnable»-ыг авсангүй (${status}) — ` +
          'зураггүйгээр дахин оролдоно. Ирцийн кадр байхгүй байх болно.',
      );
      ({ status, text } = await this.json('POST', path, cond(false)));
    }
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
