/**
 * Loopy руу илгээх текстийн формат.
 *
 * Картан дээр гарах огноог хүн уншихаар — `2026-09-23`. `common/utils/date`
 * нь Date обьекттой ажилладаг тул энд зөвхөн харуулах хэлбэрийг гаргана.
 */
export function date(value: Date, tz: string): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
