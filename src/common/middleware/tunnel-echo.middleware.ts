import { Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * Туннелийн ОНОШЛОГОО — cloudflared яг ямар хүсэлт илгээдгийг харах.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * Терминал LAN-аас `401 + WWW-Authenticate` зөв буцаадаг мөртлөө
 * туннелээр ирсэн хүсэлтэд `Invalid Operation` өгдөг. Долоон таамаг
 * хэмжилтээр хасагдсан (IP, Access токен, Host толгой, толгойн хэмжээ,
 * холболт дахин ашиглалт, Cloudflare-ийн толгойнууд). Үлдсэн ганц зам
 * бол cloudflared-ийн ЯГ юу илгээдгийг харах.
 *
 * ★ ХЭРЭГЛЭХ ЖУРАМ
 *
 * 1. Railway → `TUNNEL_ECHO=on` тавина
 * 2. Cloudflare → route-ын Service-ийг ТҮР ЗУУР `api.winfit.mn:443`
 *    (Type: HTTPS) болгоно. Host толгойн дарлалыг мөн ТҮР арилгана —
 *    эс бөгөөс `Host: 192.168.0.106` очиж Railway танихгүй.
 * 3. `https://hik.winfit.mn/ISAPI/System/deviceInfo` руу нэг хүсэлт
 * 4. Railway логоос толгойнуудыг унших
 * 5. Route-ыг БУЦААНА, `TUNNEL_ECHO`-г устгана
 *
 * ⚠ Анхдагчаар УНТРААЛТТАЙ. Асаалттай үед ч зөвхөн `/ISAPI/` замд
 * хариулна — бусад бүх хүсэлт хэвийн үргэлжилнэ.
 *
 * ⚠ Нууц утгыг БҮТНЭЭР бичихгүй: Access токен нь логд үүрд үлдэх ёсгүй.
 * Оношлоход хэрэгтэй нь утга биш, харин ТОЛГОЙ БАЙГАА эсэх ба ХЭМЖЭЭ.
 */
const SECRET = /secret|authorization|cookie|jwt|token/i;

export function tunnelEcho(enabled: boolean) {
  const log = new Logger('TunnelEcho');

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled || !req.path.startsWith('/ISAPI/')) return next();

    const h = req.headers;
    let bytes = 0;
    const lines = Object.keys(h)
      .sort()
      .map((k) => {
        const v = Array.isArray(h[k]) ? h[k].join(', ') : String(h[k] ?? '');
        bytes += k.length + v.length + 4; // «нэр: утга\r\n»
        return SECRET.test(k)
          ? `${k}: <${v.length} байт нуув>`
          : `${k}: ${v.length > 120 ? `${v.slice(0, 120)}… (${v.length} байт)` : v}`;
      });

    log.warn(
      `${req.method} ${req.originalUrl} · HTTP/${req.httpVersion} · ` +
        `толгой ${Object.keys(h).length} ширхэг, ~${bytes} байт\n  ` +
        lines.join('\n  '),
    );

    /*
     * Терминалыг дуурайж `401 + WWW-Authenticate` буцаана.
     *
     * Ингэснээр cloudflared сорилтыг зөв дамжуулж чадаж байгаа эсэхийг
     * ч зэрэг шалгана: хэрэв WinFit энэ хариуг хүлээж авбал асуудал
     * терминал талд, авахгүй бол туннель талд байна.
     */
    res
      .status(401)
      .set(
        'WWW-Authenticate',
        'Digest qop="auth", realm="TunnelEcho", nonce="echo", stale="false"',
      )
      .type('application/xml')
      .send('<?xml version="1.0"?><ResponseStatus><statusCode>1</statusCode></ResponseStatus>');
  };
}
