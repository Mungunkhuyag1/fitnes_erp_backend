/**
 * Гишүүний амьдралын мөчлөг (docs/01-integration-model.md §5).
 *
 *   lead ──(эхний сунгалт)──→ active ──(хугацаа дуусав)──→ expired
 *                               │  ↑                          │
 *                       (зогсоов)│  │(сэргээв)         (дахин төлөв)
 *                               ↓  │                          │
 *                           suspended                      active
 *                               │
 *                         (цуцлав)↓
 *                           cancelled
 */
export enum MemberStatus {
  /** Бүртгэгдсэн ч төлбөр хийгээгүй — нэвтрэх эрхгүй. */
  LEAD = 'lead',
  /** Хүчинтэй эрхтэй. */
  ACTIVE = 'active',
  /** Хугацаа дууссан. Төхөөрөмжөөс УСТГАХГҮЙ — сунгахад царай хэвээр. */
  EXPIRED = 'expired',
  /** Түр зогссон — төхөөрөмж дээр `enable=false`. */
  SUSPENDED = 'suspended',
  /** Цуцлагдсан — төхөөрөмжөөс устгагдана (царай хамт). */
  CANCELLED = 'cancelled',
}

/** Гишүүнчлэлийн эх сурвалж — тайланд орлогыг ялгахад. */
export enum MembershipSource {
  /** Онлайн төлбөр (Bonum). */
  BONUM = 'bonum',
  /** Ресепшн дээр бэлнээр. */
  CASH = 'cash',
  /** Гараар тохируулсан (урамшуулал, засвар) — `reason` заавал. */
  MANUAL = 'manual',
  /**
   * Чөлөөгөөр нөхсөн хоног.
   *
   * ⚠ Дэвтэрт бичих нь ЗААВАЛ: `recompute()` нь `access_ends_at`-ыг
   * `memberships`-аас дахин тооцдог тул шууд огноо нэмбэл дараагийн
   * дахин тооцоололд арилна. Дүн нь ҮРГЭЛЖ 0 тул орлогод нөлөөлөхгүй,
   * гэхдээ ХУДАЛДАН АВАЛТЫН тоонд орох ёсгүй — тайлан үүнийг хасна.
   */
  FREEZE = 'freeze',
}

export enum InvoiceStatus {
  PENDING = 'pending',
  PAID = 'paid',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}
