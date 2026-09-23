import { MemberStatus } from '../enums/member-status.enum';

/**
 * «Энэ ажил ЯГ ЮУ бичих гэж байна вэ» — ажилтанд харуулах тайлбар.
 *
 * ★ ЯМАР АСУУДЛЫГ ШИЙДЭЖ БАЙНА ВЭ
 *
 * Дарааллын мөр урьд нь «Терминалд бичих · Enkhzorig №221» гэж л
 * хэлдэг байв. Ямар огноо, эрх идэвхтэй эсэх, ямар нэрээр бичих нь
 * харагддаггүй. Улмаар:
 *
 *  • Алдаа гарвал ажилтан ЮУ бичигдээгүйг мэдэхгүй
 *  • «Дахин» дарахдаа юу болохыг урьдчилж хэлж чадахгүй
 *  • Терминал дээрх утгатай харьцуулах боломжгүй
 *
 * ★ ЯАГААД ОДООГИЙН ТӨЛӨВӨӨС ТООЦОХ ВЭ
 *
 * Дарааллын `payload` нь зөвхөн `memberId` агуулдаг — утгуудыг
 * ажиллах АГШИНД гишүүний одоогийн байдлаас тооцдог. Тиймээс энд ч
 * мөн адил тооцно. Энэ нь санамсаргүй биш: «Дахин» дарахад ЯГ ЭНЭ
 * утгууд явна гэдгийг баталж байгаа хэрэг.
 *
 * ⚠ Үүнээс үүдэн хуучин `done` мөрийн төлөвлөгөө нь тэр үед бичигдсэн
 * утга БИШ, ОДОО бичих байсан утга болно. Дэлгэц дээр үүнийг
 * «бичих утга» гэж нэрлэсэн нь тийм учиртай.
 *
 * ★ ЯАГААД ТУСДАА ФАЙЛ ВЭ
 *
 * `outbox.service` энэ мэдээллийг хэрэгтэй, `device-sync.service`
 * дүрмийг нь эзэмшдэг. Гэвч сүүлийнх нь `outbox`-оос импортолдог тул
 * эсрэг чиглэлд импортловол ДАВХАР ГОГЦОО үүснэ (модуль ачаалах үед
 * `undefined` болох эрсдэлтэй). Энэ файл хэнээс ч хамаарахгүй тул
 * хоёулаа найдвартай ашиглана.
 */

/*
 * ⚠ Topic-ийн НЭРС ЭНД тодорхойлогдоно, `DEVICE_TOPICS` ба
 * `LOYALTY_TOPICS` нь эднээс бүтнэ. Хоёр газарт бичвэл нэг нь
 * өөрчлөгдөхөд нөгөө нь чимээгүй таарахаа болино.
 */
export const TOPIC = {
  HIK_UPSERT: 'hik.userUpsert',
  HIK_VALIDITY: 'hik.setValidity',
  LOOPY_ALLOW: 'loopy.allowPhone',
  LOOPY_DISALLOW: 'loopy.disallowPhone',
  LOOPY_EXTEND: 'loopy.extend',
  LOOPY_STATUS: 'loopy.status',
  LOOPY_FIELDS: 'loopy.fields',
  LOOPY_PUSH: 'loopy.push',
  MAIL_SEND: 'mail.send',
} as const;

/** Төлөвлөгөөний нэг мөр. */
export interface PlanField {
  label: string;
  value: string;
}

/** Төлөвлөгөө тооцоход хэрэгтэй гишүүний талбарууд. */
export interface PlanMember {
  name: string;
  memberNo: string;
  status: MemberStatus | string;
  accessEndsAt: Date | string | null;
  createdAt: Date | string;
  phone?: string | null;
  loopyCardSerial?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  lead: 'Шинэ',
  active: 'Идэвхтэй',
  expired: 'Хугацаа дууссан',
  suspended: 'Түр зогссон',
  cancelled: 'Цуцлагдсан',
};

/**
 * Терминал дээр бичигдэх ЭРХИЙН хугацаа ба идэвх.
 *
 * ⚠ Энэ нь ДҮРЭМ, тооцоолол биш: `device-sync`, тулгалт, төлөвлөгөө
 * гурвуулан ЭНЭ функцийг дуудна. Гурван газарт тусад нь бичвэл
 * тулгалт хэзээ ч арилдаггүй хуурамч зөрүү заасаар байна.
 */
export function deviceValidity(m: PlanMember): {
  begin: Date;
  end: Date;
  enable: boolean;
} {
  const created = new Date(m.createdAt);
  return {
    begin: clampDeviceDate(created),
    end: clampDeviceDate(m.accessEndsAt ? new Date(m.accessEndsAt) : created),
    // Түр зогсоосон гишүүнд эрхийг унтраана (огноог нь хөндөхгүй).
    // Хугацаа дууссан гишүүнийг УНТРААХГҮЙ — дуусах огноо нь өөрөө
    // хаана. Терминал ч мөн адил `enable`-ыг үлдээдэг.
    //
    // ⚠ ЦУЦЛАГДСАН гишүүнийг мөн унтраана. Урьд нь түүнийг терминалаас
    // УСТГАДАГ байв; одоо бичлэг нь үлдэж, зөвхөн эрх нь хаагдана
    // (`cancel()` нь `accessEndsAt`-ыг өнөөдрөөр татдаг).
    //
    // ЯАГААД УСТГАХГҮЙ: терминал бол заалны цорын ганц хуулбар.
    // Устгавал царай нь хамт арилах ба буцаахын тулд хүн биеэр ирж
    // дахин уншуулах ёстой болно. Унтраасан бичлэг ямар ч хор
    // хүргэхгүй — нэвтрэх эрхгүй, харин сэргээхэд нэг товч.
    enable:
      m.status !== MemberStatus.SUSPENDED && m.status !== MemberStatus.CANCELLED,
  };
}

/*
 * ★ ТЕРМИНАЛЫН ОГНООНЫ ХЯЗГААР
 *
 * Hikvision нь эрхийн хугацааг 32-бит цагаар хадгалдаг тул
 * 2038 оны 1-р сарын 19-нд халина. Практикт firmware нь
 * 2037-12-31-ээс хойшхыг ТАТГАЛЗДАГ:
 *
 *     statusCode 6 · Invalid Content · badJsonContent · errorMsg: endTime
 *
 * Энэ нь бодит газар дээр гарсан: терминалаас импортлосон 10 жилийн
 * эрхтэй ажилтан (№91991499, дуусах 2037-12-31) дээр НЭГ хоног
 * нэмэхэд 2038-01-01 болж, бичилт бүрмөсөн унасан. Гишүүн WinFit
 * дээр «идэвхтэй» харагдах ч терминал хуучин утгаараа үлдэнэ —
 * чимээгүй зөрүү.
 *
 * ⚠ ХЯЗГААРЫГ ЭНД тавих нь чухал, ISAPI клиент дотор БИШ. Тулгалт
 * ба төлөвлөгөө хоёр ч мөн энэ функцийг дууддаг: клиент дотор
 * хязгаарлавал WinFit «2038-01-01» гэж үзсээр байх ба тулгалт тэр
 * гишүүнийг МӨНХӨД «зөрүүтэй» гэж заана.
 *
 * ⚠ UTC-гээр тогтоов. Сервер UTC дээр ажилладаг ч терминал руу
 * ОРОН НУТГИЙН цагаар (UB, +08) бичигддэг: 2037-12-31T00:00:00Z нь
 * тэнд 2037-12-31T08:00:00 болно — хязгаарын дотор. Хэрэв 23:59:59Z
 * гэж тавибал UB дээр 2038-01-01 болж дахин унана.
 */
const DEVICE_MAX_MS = Date.UTC(2037, 11, 31, 0, 0, 0);

/**
 * Hikvision-ий хамгийн эрт хүлээж авдаг огноо.
 *
 * Терминалаас импортлосон зарим бичлэг 1999 оны огноотой байв.
 * Эдгээрийг зарим firmware мөн татгалздаг.
 */
const DEVICE_MIN_MS = Date.UTC(2000, 0, 1, 0, 0, 0);

/** Терминал хүлээж авах муж руу оруулна. */
export function clampDeviceDate(d: Date): Date {
  const t = d.getTime();
  if (Number.isNaN(t)) return new Date(DEVICE_MIN_MS);
  if (t > DEVICE_MAX_MS) return new Date(DEVICE_MAX_MS);
  if (t < DEVICE_MIN_MS) return new Date(DEVICE_MIN_MS);
  return d;
}

/** `2026-05-28` — цаггүй, бүсийн будлианаас ангид. */
function day(d: Date | string | null): string {
  if (!d) return '—';
  const v = new Date(d);
  return Number.isNaN(v.getTime()) ? '—' : v.toISOString().slice(0, 10);
}

/**
 * Тухайн ажил ямар өгөгдөл бичих вэ.
 *
 * Гишүүн олдоогүй (жишээ нь `mail.send`, `disallowPhone`) бол хоосон
 * жагсаалт — дэлгэц тэр хэсгийг огт харуулахгүй.
 */
export function syncPlan(
  topic: string,
  m: PlanMember | null,
  payload?: Record<string, unknown> | null,
): PlanField[] {
  switch (topic) {
    case TOPIC.HIK_UPSERT:
    case TOPIC.HIK_VALIDITY: {
      if (!m) return [];
      const v = deviceValidity(m);
      return [
        { label: 'Дугаар', value: `№${m.memberNo}` },
        { label: 'Нэр', value: m.name },
        { label: 'Эхлэх огноо', value: day(v.begin) },
        { label: 'Дуусах огноо', value: day(v.end) },
        {
          label: 'Эрх',
          value: v.enable ? 'Идэвхтэй' : 'Унтраах',
        },
      ];
    }

    case TOPIC.LOOPY_ALLOW:
      /*
       * Loopy-д утас бол ГОЛ түлхүүр — картыг түүгээр олдог. Утасгүй
       * гишүүнд карт ҮҮСЭХГҮЙ тул энэ ажил мөнхөд унана. Тиймээс
       * утсыг харуулах нь оношилгооны эхний алхам.
       */
      return m
        ? [
            { label: 'Утас', value: m.phone || '— (утасгүй)' },
            { label: 'Гишүүн', value: `${m.name} №${m.memberNo}` },
          ]
        : [];

    case TOPIC.LOOPY_DISALLOW:
      return [
        {
          label: 'Утас',
          value: String(payload?.phone ?? '—'),
        },
      ];

    case TOPIC.LOOPY_EXTEND:
      return m
        ? [
            { label: 'Карт', value: m.loopyCardSerial || '— (карт үүсээгүй)' },
            { label: 'Дуусах огноо', value: day(m.accessEndsAt) },
          ]
        : [];

    case TOPIC.LOOPY_STATUS:
      return m
        ? [
            { label: 'Карт', value: m.loopyCardSerial || '— (карт үүсээгүй)' },
            {
              label: 'Төлөв',
              value: STATUS_LABEL[String(m.status)] ?? String(m.status),
            },
          ]
        : [];

    case TOPIC.LOOPY_FIELDS:
      return m
        ? [
            { label: 'Карт', value: m.loopyCardSerial || '— (карт үүсээгүй)' },
            { label: 'Нэр', value: m.name },
            { label: 'Дугаар', value: `№${m.memberNo}` },
          ]
        : [];

    case TOPIC.LOOPY_PUSH:
      return [
        { label: 'Карт', value: m?.loopyCardSerial || '—' },
        // Push-ийн бие нь `payload` дотор бэлэн байдаг.
        { label: 'Мэдэгдэл', value: String(payload?.message ?? '—') },
      ];

    case TOPIC.MAIL_SEND:
      return [
        { label: 'Хүлээн авагч', value: String(payload?.to ?? '—') },
        { label: 'Гарчиг', value: String(payload?.subject ?? '—') },
      ];

    default:
      return [];
  }
}
