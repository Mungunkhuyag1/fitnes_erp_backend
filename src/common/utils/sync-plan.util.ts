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
    begin: created,
    end: m.accessEndsAt ? new Date(m.accessEndsAt) : created,
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
