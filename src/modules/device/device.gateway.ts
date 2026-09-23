/**
 * Hikvision терминалтай харилцах ЦОРЫН ГАНЦ гарц.
 *
 * Бизнесийн код энэ интерфейсээс цааш юу байгааг мэдэхгүй:
 *   • `StubDeviceGateway`  — хөгжүүлэлт (төхөөрөмжгүй, алдаа дуурайлгана)
 *   • `AgentDeviceGateway` — жинхэнэ (on-prem agent руу WSS-ээр, B12)
 *
 * Сонголт нь `DEVICE_GATEWAY` env-ээр — docs/05-backend-api.md §6.1.
 */
export const DEVICE_GATEWAY = Symbol('DEVICE_GATEWAY');

/**
 * Терминал дээр тухайн хэрэглэгч БАЙХГҮЙ.
 *
 * Хэзээ гарах вэ: терминалыг factory reset хийсэн, хэн нэгэн iVMS-ээс
 * гараар устгасан, эсвэл шинэ төхөөрөмж тавьсан.
 *
 * Энэ алдаа нь «дахин оролдоод нэмэргүй» БОЛОВЧ шийдэгдэхгүй алдаа биш —
 * `setValidity` бүтэлгүйтвэл БҮТЭН `upsertUser` хийж нөхнө (device-sync.service).
 */
export class MissingDeviceUserError extends Error {
  constructor(readonly employeeNo: string) {
    super(`Терминал дээр ${employeeNo} дугаартай хэрэглэгч байхгүй`);
    this.name = 'MissingDeviceUserError';
  }
}

/**
 * Терминал царай ОЛСОНГҮЙ.
 *
 * Хүн ирээгүй, хол зогссон, эсвэл гэрэл муу. Энэ нь ЭВДРЭЛ БИШ —
 * дэлгэц дээр «дахин оролдоно уу» гэж хэлэх ёстой үр дүн. Ердийн
 * алдаанаас ялгахгүй бол ажилтан терминал эвдэрсэн гэж бодно.
 */
export class FaceCaptureTimeoutError extends Error {
  constructor(message = 'Царай олдсонгүй — терминалын өмнө зогсоод дахин оролдоно уу') {
    super(message);
    this.name = 'FaceCaptureTimeoutError';
  }
}

/**
 * Терминал царайг барьсан ч ХҮЛЭЭЖ АВСАНГҮЙ (гэрэл, өнцөг, зай).
 *
 * `FaceCaptureTimeoutError`-тай адилхан «хүнээ дахин зогсоо» гэсэн үр
 * дүн боловч ШАЛТГААН нь өөр: тэр нь «хэн ч ирээгүй», энэ нь «ирсэн ч
 * болсонгүй». Ажилтанд өгөх зөвлөгөө хоёр тохиолдолд өөр тул нэгтгэж
 * болохгүй.
 */
export class FaceRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceRejectedError';
  }
}

export interface UpsertUserInput {
  employeeNo: string;
  name: string;
  /** Эрхийн эхлэх/дуусах хугацаа (Hikvision `Valid`). */
  begin: Date;
  end: Date;
  /** `false` = түр зогсоосон (гишүүнчлэл суспенд). */
  enable: boolean;
}

export interface SetValidityInput {
  employeeNo: string;
  begin: Date;
  end: Date;
  enable: boolean;
}

export interface DeviceInfo {
  model: string;
  firmware: string;
  online: boolean;
  /** Царай/хэрэглэгч/эвентийн ашиглалт — багтаамж дүүрэхийг хянана. */
  capacity?: Record<string, number>;
}

/** Терминал дээр бодитоор байгаа хэрэглэгчийн мөр — тулгалтад. */
export interface DeviceUserRow {
  /**
   * ⚠ ТЕКСТ. Терминал дээр энэ нь текст талбар бөгөөд `admin`, `Adiya`
   * гэх мэт утга гараар бичигдэж болно. ISAPI өөрөө ч `String(...)`-ээр
   * дамжуулдаг — тоо болгох нь WinFit-ийн зохиомол хязгаарлалт байв.
   */
  employeeNo: string;
  name: string;
  begin: Date | null;
  end: Date | null;
  enable: boolean;
}

/**
 * Царайны төлөв ба зураг.
 *
 * ⚠ `path` нь терминалын ДОТООД зам (`/LOCALS/...`), хосттой БҮТЭН
 * хаяг БИШ: IP солигдоход хадгалсан хаяг эзэнгүй болно.
 */
export interface FaceInfo {
  enrolled: boolean;
  path: string | null;
}

export interface DeviceGateway {
  /** Хэрэглэгч үүсгэх / шинэчлэх (идемпотент — `employeeNo` дээр upsert). */
  upsertUser(input: UpsertUserInput): Promise<void>;

  /** Зөвхөн хугацаа/идэвхийг өөрчлөх (сунгалт, зогсоолт). */
  setValidity(input: SetValidityInput): Promise<void>;

  /*
   * ⚠ `deleteUser` ЭНД БАЙХГҮЙ — ЗОРИУД.
   *
   * Терминал бол заалны цорын ганц хуулбар. Устгавал царай нь хамт
   * арилах ба буцаахын тулд хүн биеэр ирж дахин уншуулна. Эрх хаах
   * бол `setValidity` (`enable=false`) хангалттай — буцаахад нэг товч.
   *
   * Интерфейсээс хассан нь бодлого биш БҮТЭЦ: дуудах арга байхгүй тул
   * санамсаргүй устгах боломжгүй.
   */

  /**
   * Терминал дээрх БҮХ хэрэглэгч — шөнийн тулгалтад.
   *
   * ⚠ ХҮНД дуудлага (хуудаслаж татна). Ойрхон давтахгүй.
   */
  listUsers(): Promise<DeviceUserRow[]>;

  /** Заасан хүмүүсийн царай бүртгэгдсэн эсэх. */
  faceStatus(employeeNos: string[]): Promise<Record<string, FaceInfo>>;

  /**
   * Терминалыг ЦАРАЙ УНШУУЛАХ горимд оруулж, барьсан зургийг тухайн
   * хүний нэр дээр хадгална.
   *
   * ★ ЯАГААД ГАРЦАД БАЙНА ВЭ
   *
   * Урьд нь царай нь зөвхөн терминалын дэлгэцээс гараар бүртгэгддэг
   * байсан: ажилтан админ ПИН оруулж, цэсээр орж, хүнийг олж байж
   * уншуулна. Шинэ гишүүн бүрт энэ нь 1-2 минут бөгөөд ихэнхдээ
   * мартагдаад, хүн маргааш хаалган дээр зогсоно.
   *
   * ⚠ УДААН (хүн ойртохыг хүлээнэ) бөгөөд ХҮН БИЕЭР байх шаардлагатай.
   * Тиймээс outbox-оор биш, дэлгэцээс ШУУД дуудагдана.
   *
   * ⚠ Хэрэглэгч терминал дээр БАЙХ ёстой: царай нь `employeeNo`-д
   * холбогддог. Байхгүй бол `MissingDeviceUserError`.
   */
  enrollFace(employeeNo: string): Promise<FaceInfo>;

  openDoor(doorNo?: number): Promise<void>;

  info(): Promise<DeviceInfo>;

  /**
   * Заасан хугацааны нэвтрэлтийн эвент — НӨӨЦ суваг.
   *
   * Гол суваг нь терминалын түлхэлт (`POST /webhooks/device/:secret`).
   * Гэвч терминал дахин илгээхийг оролддоггүй тул сүлжээ тасрах,
   * backend дахин ассах үед эвент алдагдана. Энэ нь давхцах цонхоор
   * татаж түүнийг нөхнө.
   */
  fetchEvents(
    from: Date,
    to: Date,
  ): Promise<Record<string, unknown>[]>;
}
