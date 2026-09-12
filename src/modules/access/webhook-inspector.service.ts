import { Injectable } from '@nestjs/common';

export interface WebhookTrace {
  at: string;
  ip: string | null;
  contentType: string;
  bytes: number;
  format: string;
  parsed: number;
  ingested: number;
  /** Түүхий бие — эхний хэсэг нь. Оношлоход ЭНЭ л хэрэгтэй. */
  sample: string;
}

/**
 * Сүүлийн түлхэлтүүдийг санаж, дашбордоос харуулах.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * Терминал 200 хариу авмагц «болсон» гэж үзнэ. Хэрэв бид биеийг нь
 * задалж чадаагүй бол ирц бүртгэгдэхгүй мөртлөө терминал талд ЯМАР Ч
 * алдаа харагдахгүй. Заалан дээр зогсоод «яагаад ирэхгүй байна» гэж
 * таамаглахаас илүү ЮУ ИРСНИЙГ нь хараад тааруулах нь хурдан.
 *
 * ⚠ Санах ойд байна — дахин ассан үед арилна. Байнгын лог БИШ,
 * тохируулах үеийн толь.
 *
 * ⚠ Царайны зураг хадгалахгүй: зөвхөн эхний 2000 тэмдэгт, тэр нь ч
 * хоёртын хэсэгт хүрэхгүй (multipart-ийн текст хэсэг эхэнд байдаг).
 */
@Injectable()
export class WebhookInspector {
  private static readonly KEEP = 10;
  private static readonly SAMPLE = 2000;
  private readonly items: WebhookTrace[] = [];

  record(t: Omit<WebhookTrace, 'at' | 'sample'> & { raw: string }): void {
    this.items.unshift({
      at: new Date().toISOString(),
      ip: t.ip,
      contentType: t.contentType,
      bytes: t.bytes,
      format: t.format,
      parsed: t.parsed,
      ingested: t.ingested,
      sample: t.raw.slice(0, WebhookInspector.SAMPLE),
    });
    if (this.items.length > WebhookInspector.KEEP) this.items.pop();
  }

  list(): WebhookTrace[] {
    return this.items;
  }
}
