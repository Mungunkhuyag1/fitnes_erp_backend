/**
 * Мэйлийн загвар — ЭНГИЙН HTML.
 *
 * ⚠ Мэйлийн клиентүүд орчин үеийн CSS-ийг дэмждэггүй: flexbox, grid,
 * гадаад stylesheet бүгд унана. Тиймээс хүснэгт ба мөрийн `style`
 * шинжээр л зурна — 2005 оны HTML шиг харагдах нь зөв.
 */
const WRAP = (title: string, body: string): string => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f4;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
    <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#7a8168">WinFit</div>
    <h1 style="font-size:19px;margin:6px 0 18px;color:#15180f">${title}</h1>
    ${body}
    <p style="margin:22px 0 0;font-size:12px;color:#9aa189">
      Энэ мэйл WinFit системээс автоматаар илгээгдэв.
    </p>
  </div>
</div>`;

const money = (n: number): string => `${n.toLocaleString('en-US')}₮`;

const row = (label: string, value: string, strong = false): string => `
  <tr>
    <td style="padding:7px 0;color:#5a6050;font-size:14px">${label}</td>
    <td style="padding:7px 0;text-align:right;font-size:${strong ? '17px' : '14px'};
               font-weight:${strong ? '700' : '400'};color:#15180f">${value}</td>
  </tr>`;

export interface DigestData {
  date: string;
  revenue: number;
  sales: number;
  cash: number;
  online: number;
  newMembers: number;
  visits: number;
  lockerRevenue: number;
  awaitingApproval: number;
}

export function dailyDigest(d: DigestData): { subject: string; html: string } {
  const body = `
  <table style="width:100%;border-collapse:collapse">
    ${row('Нийт орлого', money(d.revenue), true)}
    ${row('Гишүүнчлэл', `${d.sales} худалдан авалт`)}
    ${row('Бэлнээр', money(d.cash))}
    ${row('Онлайнаар', money(d.online))}
    ${d.lockerRevenue ? row('Шүүгээний түрээс', money(d.lockerRevenue)) : ''}
    <tr><td colspan="2" style="border-top:1px solid #e5e8dc;padding-top:8px"></td></tr>
    ${row('Шинэ гишүүн', String(d.newMembers))}
    ${row('Ирц', `${d.visits} хүн`)}
  </table>
  ${
    d.awaitingApproval
      ? `<p style="margin:16px 0 0;padding:11px 14px;border-radius:8px;
                   background:#fdf3d8;color:#7a5a06;font-size:14px">
           <b>${d.awaitingApproval}</b> хөнгөлөлттэй төлбөр баримт шалгуулахаар
           хүлээж байна — эрх нь нээгдээгүй.
         </p>`
      : ''
  }`;
  return {
    subject: `WinFit — ${d.date}: ${money(d.revenue)}`,
    html: WRAP(`${d.date} · өдрийн хураангуй`, body),
  };
}

export function largePayment(p: {
  memberName: string;
  packageName: string;
  amount: number;
  at: string;
}): { subject: string; html: string } {
  // ⚠ «Том төлбөр» гэж бичихгүй: хязгаарыг админ өөрөө тохируулдаг тул
  // 100,000₮ болговол ердийн 250,000₮-ийн худалдан авалт бүр «том»
  // гэж ирнэ. Хэлбэлзэхгүй үг сонгоно.
  return {
    subject: `WinFit — төлбөр: ${money(p.amount)}`,
    html: WRAP(
      'Төлбөр орлоо',
      `<table style="width:100%;border-collapse:collapse">
         ${row('Дүн', money(p.amount), true)}
         ${row('Гишүүн', p.memberName)}
         ${row('Багц', p.packageName)}
         ${row('Хугацаа', p.at)}
       </table>`,
    ),
  };
}

export function testMail(): { subject: string; html: string } {
  return {
    subject: 'WinFit — туршилтын мэйл',
    html: WRAP(
      'Тохиргоо зөв байна',
      `<p style="font-size:14px;color:#5a6050;margin:0">
         Энэ мэйл ирсэн бол домэйн, түлхүүр, хаяг гурвуулаа зөв байна.
         Одооноос өдрийн хураангуй автоматаар ирнэ.
       </p>`,
    ),
  };
}
