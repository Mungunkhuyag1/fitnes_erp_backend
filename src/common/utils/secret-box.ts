import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Жижиг нууцлагч — DB-д хадгалах нууц үгэнд.
 *
 * ЯАГААД ХЭРЭГТЭЙ ВЭ: терминалын нууц үг DB-д ЦЭЭЖЭЭР хэвтвэл backup,
 * лог, `pg_dump` бүрээр тархана. Мөн admin эрхтэй ажилтан SQL уншиж
 * терминал руу шууд орох боломжтой болно.
 *
 * ⚠ Түлхүүр нь `JWT_SECRET`-ээс гардаг тул түүнийг СОЛИВОЛ хуучин
 * нууц үг тайлагдахгүй — дэлгэцээс дахин оруулна (алдаа шидэхгүй,
 * `null` буцаана).
 *
 * AES-256-GCM: зөвхөн нууцлахаас гадна ЗАСВАРЛАСАН эсэхийг барина
 * (tag таарахгүй бол тайлалт унана).
 */
const SALT = 'winfit.device.v1';

function keyFrom(secret: string): Buffer {
  return scryptSync(secret, SALT, 32);
}

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [
    'v1',
    iv.toString('base64'),
    c.getAuthTag().toString('base64'),
    ct.toString('base64'),
  ].join(':');
}

/** Тайлж чадвал текст, эс чадвал `null` — дуудагч нь буцаж асууна. */
export function open(sealed: string, secret: string): string | null {
  try {
    const [v, iv, tag, ct] = sealed.split(':');
    if (v !== 'v1' || !iv || !tag || !ct) return null;
    const d = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
