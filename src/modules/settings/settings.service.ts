import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './setting.entity';

/**
 * Тохиргооны түлхүүр ба анхдагч утга.
 *
 * Шинэ тохиргоо нэмэхэд ЗӨВХӨН энд нэмнэ — migration шаардахгүй (DB-д мөр
 * байхгүй бол анхдагч утга хэрэглэгдэнэ).
 */
export const SETTING_DEFAULTS = {
  /** Ресепшн ажилтан бэлнээр эрх сунгаж болох уу (docs/05 §2). */
  allow_reception_extend: false,
  /** Эрх дуусахаас өмнөх сануулгын цэгүүд (B11). */
  reminder_milestones: ['T-7', 'T-3', 'T-1', 'T0'] as string[],
  /** Фитнесийн нэр — карт, төлбөрийн хуудсанд харагдана. */
  gym_name: 'WinFit',
  /**
   * Хувцас солих өрөөнүүд. Эрэгтэй/эмэгтэй өрөөний шүүгээний дугаарлалт
   * ТУСДАА тул шүүгээг ҮРГЭЛЖ (өрөө + дугаар) хосоор заана.
   */
  locker_zones: ['Эрэгтэй', 'Эмэгтэй'] as string[],
  /**
   * Хүйс → аль өрөөний шүүгээ. Ресепшн шүүгээ олгоход өрөөг урьдчилан
   * сонгоход л ашиглагдана — хориглох дүрэм БИШ, ажилтан үргэлж өөрчилж
   * чадна. Өрөөний нэр `locker_zones`-той тааруулж бичнэ.
   */
  locker_zone_by_gender: { male: 'Эрэгтэй', female: 'Эмэгтэй' } as Record<string, string>,
  /** Шүүгээний түрээсийн санал болгох үнэ (30 хоног, ₮). */
  locker_price_per_month: 30000,
  /**
   * Чөлөөний хязгаар — админ өөрөө тохируулна.
   *
   * ⚠ Хязгааргүй чөлөө нь ҮНЭГҮЙ ГИШҮҮНЧЛЭЛ болно: гишүүн жилийн багц
   * авчихаад тасралтгүй чөлөө авбал хугацаа нь хэзээ ч дуусахгүй.
   */
  freeze_days_per_year: 30,
  /** Нэг удаад дээд тал — «6 сарын чөлөө» гэж асуухаас сэргийлнэ. */
  freeze_max_once: 14,
  /** Хамгийн багадаа — 1 хоногийн чөлөө утгагүй ажил үүсгэнэ. */
  freeze_min_days: 3,
  /**
   * Аль Loopy программ дээр карт үүсгэхийг ЭНД шийднэ.
   *
   * `null` бол `LOOPY_PROGRAM_ID` env-ийг хэрэглэнэ. DB-д хадгалснаар
   * программ солиход deploy шаардахгүй — админ дэлгэцээс сонгоно.
   */
  loopy_program_id: null as string | null,
  /**
   * Шөнийн тулгалт Loopy-гийн жагсаалтаас илүү дугаарыг ӨӨРӨӨ хасах уу.
   *
   * Анхдагчаар УНТРААЛТТАЙ: нэг программыг өөр эх сурвалж хуваалцаж
   * болох тул чимээгүй устгах нь эргэж буцах аргагүй алдаа болно.
   * Асаахаас өмнө /sync дэлгэцээс жагсаалтыг нэг харна уу.
   */
  loopy_allowlist_autoclean: false,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

@Injectable()
export class SettingsService {
  /** Тохиргоо ховор өөрчлөгддөг тул санах ойд барина (60 сек). */
  private cache = new Map<string, { value: unknown; at: number }>();
  private static readonly TTL_MS = 60_000;

  constructor(
    @InjectRepository(Setting) private readonly repo: Repository<Setting>,
  ) {}

  async get<K extends SettingKey>(
    key: K,
  ): Promise<(typeof SETTING_DEFAULTS)[K]> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < SettingsService.TTL_MS) {
      return cached.value as (typeof SETTING_DEFAULTS)[K];
    }
    const row = await this.repo.findOne({ where: { key } });
    const value = (row?.value ?? SETTING_DEFAULTS[key]) as (typeof SETTING_DEFAULTS)[K];
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async set<K extends SettingKey>(
    key: K,
    value: (typeof SETTING_DEFAULTS)[K],
  ): Promise<void> {
    await this.repo.save(this.repo.create({ key, value }));
    this.cache.delete(key);
  }

  /** Бүх тохиргоо (анхдагч + хадгалагдсан). */
  async all(): Promise<Record<string, unknown>> {
    const rows = await this.repo.find();
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...SETTING_DEFAULTS, ...stored };
  }
}
