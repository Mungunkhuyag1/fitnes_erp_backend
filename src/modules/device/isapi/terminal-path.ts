/**
 * Терминалын зургийн хаягийг ЗАМ болгон цэвэрлэнэ.
 *
 * ★ ЯАГААД БҮТЭН ХАЯГИЙГ ХАДГАЛЖ БОЛОХГҮЙ ВЭ
 *
 * Терминал нь өөрийн хаягаа зургийн URL дотор оруулж буцаадаг:
 *
 *   http://192.168.0.106/LOCALS/pic/acsLinkCap/0_1.jpg@WEB00000001
 *
 * Энэ IP нь DHCP-ээр СОЛИГДДОГ, терминал солиход өөрчлөгддөг, ирээдүйд
 * `hik.winfit.mn` гэх мэт домэйн болж ч мэднэ. Хадгалсан бүтэн хаяг нь
 * маргааш эзэнгүй болно — зөвхөн ЗАМЫГ хадгалж, хостыг нь харуулах
 * агшинд тохиргооноос угсарна.
 *
 * ⚠ Зургийн БАЙТЫГ өгөгдлийн санд хадгалахгүй: өдөрт хэдэн зуун
 * уншуулалт бүрд зураг хадгалбал сан хэдхэн сард хэдэн арван ГБ болно.
 */

/** Зөвшөөрөгдөх угтварууд — терминалын дотоод файлын сан. */
const ALLOWED = ['/LOCALS/', '/pic/', '/doc/'];

/**
 * Бүтэн URL эсвэл замыг → цэвэр зам.
 *
 * Буцаах утга нь `/`-ээр эхэлнэ, хост агуулахгүй. Танихгүй эсвэл
 * аюултай хэлбэрт `null` — хадгалахгүй нь буруу зам хадгалснаас дээр.
 */
export function terminalPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  let path: string;
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      path = `${u.pathname}${u.search}`;
    } catch {
      return null;
    }
  } else if (value.startsWith('/')) {
    path = value;
  } else {
    // Харьцангуй зам — терминал ийм хэлбэрээр буцаадаггүй тул танихгүй.
    return null;
  }

  // ⚠ `..` нь зөвхөн буруу зам биш, ХАМГААЛАЛТЫН нүх: терминалын өөр
  // хэсэг рүү гарах оролдлого байж болно.
  if (path.includes('..')) return null;
  if (!ALLOWED.some((p) => path.toUpperCase().startsWith(p.toUpperCase()))) {
    return null;
  }
  return path.slice(0, 300);
}

/** Хадгалсан зам нь одоо ч зөвшөөрөгдөх эсэх — татахын өмнө шалгана. */
export function isSafeTerminalPath(path: string): boolean {
  return terminalPath(path) !== null;
}
