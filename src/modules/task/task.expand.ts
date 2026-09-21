import { TaskKind } from './task.entity';

/**
 * Давталтын дүрмийг ОГНООНЫ ЖАГСААЛТ болгон задлах.
 *
 * ★ ЯАГААД ЦЭВЭР ФУНКЦ ВЭ
 *
 * Энэ нь модулийн ЦОРЫН ГАНЦ төвөгтэй логик: календарь, нүүрийн жагсаалт,
 * «хоцорсон» тооцоолол бүгд үүнээс гардаг. Сан, цаг, тохиргооноос
 * хамаарахгүй болгосон тул скриптээр шууд шалгаж болно
 * (`scripts/check-task-expand.ts`).
 *
 * ★ ОГНОО НЬ ТЕКСТ (`YYYY-MM-DD`)
 *
 * `Date` объект ашиглавал цаг бүс орооцолдоно: `new Date('2026-09-22')`
 * нь UTC шөнө дунд бөгөөд UB (UTC+8) дээр орон нутгийн 08:00 болно.
 * Хуанлийн өдөрт цаг бүс хамаагүй тул бүх тооцооллыг текст ба UTC
 * дээр хийж, хэзээ ч орон нутгийн цаг руу хөрвүүлэхгүй.
 */

export interface RecurrenceRule {
  kind: TaskKind;
  /** `YYYY-MM-DD` — тулгуур огноо. */
  startsOn: string;
  /** `YYYY-MM-DD` эсвэл `null`. */
  endsOn: string | null;
  active: boolean;
}

/** `YYYY-MM-DD` → UTC полдень. Өдрийн дундыг авах нь DST-ээс хамгаална. */
function toUtc(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
}

/** UTC огноо → `YYYY-MM-DD`. */
function toStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Тухайн сард хэдэн өдөр байна. */
function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * Давталтын огноонуудыг `[from, to]` МУЖИД буцаана (хоёр талдаа хамрана).
 *
 * ⚠ ХЯЗГААР. Нэг дуудлагад дээд тал нь 400 огноо — жилийн календарийг
 * өдөр бүрээр нээхэд ч хүрэхгүй тоо. Хэрэв муж нь хэт өргөн байвал
 * дуудагч тал нь буруу — чимээгүй тайрахын оронд энд зогсооно.
 */
export function expandRule(
  rule: RecurrenceRule,
  from: string,
  to: string,
): string[] {
  if (!rule.active) return [];

  // Дүрмийн төгсгөл нь мужийн төгсгөлөөс өмнө бол түүгээр хязгаарлана.
  const last = rule.endsOn && rule.endsOn < to ? rule.endsOn : to;
  if (last < from) return [];
  // Эхлэхээс өмнөх огноо гарахгүй.
  const first = rule.startsOn > from ? rule.startsOn : from;
  if (first > last) return [];

  const out: string[] = [];
  const LIMIT = 400;

  switch (rule.kind) {
    /*
     * НЭГ УДАА — тулгуур огноо өөрөө. Муж дотор байвал ганц утга.
     * `first`/`last`-ыг ашиглахгүй: `startsOn` нь мужаас гадна байж
     * болох ба тэр үед хоосон байх ёстой.
     */
    case TaskKind.ONCE:
      return rule.startsOn >= from && rule.startsOn <= last
        ? [rule.startsOn]
        : [];

    case TaskKind.DAILY: {
      for (
        let d = toUtc(first);
        toStr(d) <= last && out.length < LIMIT;
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        out.push(toStr(d));
      }
      return out;
    }

    /*
     * 7 ХОНОГ БҮР — тулгуур огнооны ГАРАГААР.
     *
     * Эхлэх цэгийг `startsOn`-оос 7-гийн алхмаар урагшлуулж олно.
     * `first`-ээс шууд гараг тааруулж эхэлбэл `startsOn`-оос өмнөх
     * долоо хоногт буруу утга гарах эрсдэлтэй.
     */
    case TaskKind.WEEKLY: {
      const d = toUtc(rule.startsOn);
      while (toStr(d) < first) d.setUTCDate(d.getUTCDate() + 7);
      for (; toStr(d) <= last && out.length < LIMIT; d.setUTCDate(d.getUTCDate() + 7)) {
        out.push(toStr(d));
      }
      return out;
    }

    /*
     * САР БҮР — тулгуур огнооны ӨДРИЙН ДУГААРААР.
     *
     * ⚠ 31-нд эхэлсэн ажил 30 хоногтой сард ЯАХ ВЭ. Сонголт:
     * тухайн сарын СҮҮЛЧИЙН өдөр рүү татна (2-р сард 28/29).
     * Алгасах хувилбарыг сонгоогүй: «сар бүр» гэж тохируулсан ажил
     * жилд 4-5 сар алга болвол ажилтан итгэхээ болино.
     */
    case TaskKind.MONTHLY: {
      const anchor = toUtc(rule.startsOn);
      const anchorDay = anchor.getUTCDate();
      let y = anchor.getUTCFullYear();
      let m = anchor.getUTCMonth();

      for (let i = 0; i < LIMIT; i++) {
        const day = Math.min(anchorDay, daysInMonth(y, m));
        const s = toStr(new Date(Date.UTC(y, m, day, 12)));
        if (s > last) break;
        if (s >= first) out.push(s);
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
      }
      return out;
    }
  }
}
