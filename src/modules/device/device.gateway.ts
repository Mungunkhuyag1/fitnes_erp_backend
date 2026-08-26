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
  constructor(readonly employeeNo: number) {
    super(`Терминал дээр ${employeeNo} дугаартай хэрэглэгч байхгүй`);
    this.name = 'MissingDeviceUserError';
  }
}

export interface UpsertUserInput {
  employeeNo: number;
  name: string;
  /** Эрхийн эхлэх/дуусах хугацаа (Hikvision `Valid`). */
  begin: Date;
  end: Date;
  /** `false` = түр зогсоосон (гишүүнчлэл суспенд). */
  enable: boolean;
}

export interface SetValidityInput {
  employeeNo: number;
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

export interface DeviceGateway {
  /** Хэрэглэгч үүсгэх / шинэчлэх (идемпотент — `employeeNo` дээр upsert). */
  upsertUser(input: UpsertUserInput): Promise<void>;

  /** Зөвхөн хугацаа/идэвхийг өөрчлөх (сунгалт, зогсоолт). */
  setValidity(input: SetValidityInput): Promise<void>;

  /** Хэрэглэгчийг устгах — царай нь хамт устана (зөвхөн цуцлах үед). */
  deleteUser(employeeNo: number): Promise<void>;

  /** Заасан хүмүүсийн царай бүртгэгдсэн эсэх. */
  faceStatus(employeeNos: number[]): Promise<Record<number, boolean>>;

  openDoor(doorNo?: number): Promise<void>;

  info(): Promise<DeviceInfo>;
}
