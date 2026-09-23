import { IsapiClient } from '../src/modules/device/isapi/isapi.client';

/**
 * Терминал дээрх эрхийг ДАРЖ БИЧИХГҮЙ гэдгийг шалгана.
 *
 * ★ ЯАГААД ЭНЭ ТЕСТ ХЭРЭГТЭЙ ВЭ
 *
 * `DEVICE_WRITES=on` болгомогц WinFit нь гишүүн бүрийг терминал руу
 * бичиж эхэлнэ. Хэрэв `Modify` нь `userType`-ыг дарж бичвэл заалны
 * ГУРВАН АДМИН (№1, №17, №91991499) энгийн хэрэглэгч болж, төхөөрөмжийн
 * цэс рүү орох эрхээ алдана.
 *
 * Энэ эвдрэл нь ЧИМЭЭГҮЙ: лог дээр «updated» гэж амжилттай харагдана.
 * Хэн нэгэн терминал дээр очиж цэс нээх гэж оролдтол мэдэгдэнэ — тэр
 * үед шалтгааныг холбох нь бараг боломжгүй.
 *
 * Тиймээс жинхэнэ төхөөрөмж хэрэггүйгээр: HTTP давхаргыг хуурамчаар
 * орлуулж, ЯМАР бие илгээхийг нь барьж шалгана.
 */

let fails = 0;
function ok(name: string, cond: boolean, got?: unknown): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    fails++;
    console.log(`✗ ${name}${got === undefined ? '' : `\n   got: ${JSON.stringify(got)}`}`);
  }
}

interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/**
 * Терминалыг дуурайлгана.
 *
 * `searchUser` нь өгсөн бичлэгийг буцаана, бусад бүх дуудлагыг
 * барьж аваад `statusCode: 1` (OK) гэж хариулна.
 */
function fakeClient(existing: Record<string, unknown> | null): {
  client: IsapiClient;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const client = new IsapiClient({ host: 'x', user: 'u', password: 'p' });

  // `http` нь private — тест зориулалтаар орлуулна.
  (client as unknown as { http: unknown }).http = {
    request(method: string, path: string, body?: string) {
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      if (path.includes('UserInfo/Search')) {
        return Promise.resolve({
          status: 200,
          text: JSON.stringify({
            UserInfoSearch: { UserInfo: existing ? [existing] : [] },
          }),
        });
      }
      sent.push({ method, path, body: parsed });
      return Promise.resolve({ status: 200, text: '{"statusCode":1}' });
    },
  };
  return { client, sent };
}

const INPUT = {
  employeeNo: '17',
  name: 'admin anu',
  beginTime: '2026-01-01T00:00:00',
  endTime: '2036-01-01T23:59:59',
  enable: true,
};

/** Терминал дээрх ЖИНХЭНЭ админ бичлэг (экспортын хэлбэрээр). */
const ADMIN = {
  employeeNo: '17',
  name: 'admin anu',
  userType: 'normal',
  localUIRight: true,
  gender: 'female',
  groupId: 1,
  doorRight: '1',
  RightPlan: [{ doorNo: 1, planTemplateNo: '3' }],
  Valid: { enable: true, beginTime: '2025-01-01T00:00:00', endTime: '2035-01-01T23:59:59' },
  // ⚠ Зөвхөн унших талбарууд — буцааж илгээвэл зарим firmware татгалздаг.
  numOfFace: 1,
  numOfCard: 0,
  checkUser: true,
};

void (async () => {
  // ── 1. БАЙГАА хэрэглэгч: эрх нь хэвээр үлдэх ёстой ──
  {
    const { client, sent } = fakeClient(ADMIN);
    const res = await client.upsertUser(INPUT);
    const u = sent[0]?.body.UserInfo as Record<string, unknown>;

    ok('байгаа хэрэглэгч → Modify', sent[0]?.path.includes('Modify'), sent[0]?.path);
    ok('байгаа хэрэглэгч → updated', res === 'updated', res);
    ok('localUIRight ХЭВЭЭР', u?.localUIRight === true, u?.localUIRight);
    ok('хаалганы хуваарь ХЭВЭЭР (planTemplateNo 3)',
      JSON.stringify(u?.RightPlan) === JSON.stringify(ADMIN.RightPlan), u?.RightPlan);
    ok('хүйс ХЭВЭЭР', u?.gender === 'female', u?.gender);
    ok('groupId ХЭВЭЭР', u?.groupId === 1, u?.groupId);

    // WinFit эзэмшдэг зүйлс нь ШИНЭЧЛЭГДСЭН байх ёстой.
    ok('нэр шинэчлэгдэв', u?.name === 'admin anu', u?.name);
    ok(
      'хугацаа ШИНЭЧЛЭГДЭВ (WinFit эзэмшинэ)',
      (u?.Valid as Record<string, unknown>)?.endTime === INPUT.endTime,
      u?.Valid,
    );

    /*
     * ⚠ Зөвхөн унших талбарыг буцааж илгээхгүй: зарим firmware
     * `numOfFace`-тай хүсэлтийг «badParameters» гэж татгалздаг.
     */
    ok('numOfFace илгээхгүй', u?.numOfFace === undefined, u?.numOfFace);
    ok('numOfCard илгээхгүй', u?.numOfCard === undefined, u?.numOfCard);
    ok('checkUser илгээхгүй', u?.checkUser === undefined, u?.checkUser);
  }

  // ── 2. `visitor` төрөл ч хэвээр ──
  {
    const { client, sent } = fakeClient({ ...ADMIN, userType: 'visitor' });
    await client.upsertUser(INPUT);
    const u = sent[0]?.body.UserInfo as Record<string, unknown>;
    ok('visitor ХЭВЭЭР үлдэнэ', u?.userType === 'visitor', u?.userType);
  }

  // ── 3. ШИНЭ хэрэглэгч: анхдагчаар үүснэ ──
  {
    const { client, sent } = fakeClient(null);
    const res = await client.upsertUser({ ...INPUT, employeeNo: '9001' });
    const u = sent[0]?.body.UserInfo as Record<string, unknown>;

    ok('шинэ хэрэглэгч → Record', sent[0]?.path.includes('Record'), sent[0]?.path);
    ok('шинэ хэрэглэгч → created', res === 'created', res);
    ok('шинэ нь normal', u?.userType === 'normal', u?.userType);
    ok('шинэд хаалганы эрх тавина', u?.doorRight === '1', u?.doorRight);
  }

  // ── 4. `setValidity` (эрх сунгах) ч мөн адил ──
  {
    const { client, sent } = fakeClient(ADMIN);
    await client.setValidity(INPUT);
    const u = sent[0]?.body.UserInfo as Record<string, unknown>;
    ok('эрх сунгахад localUIRight ХЭВЭЭР', u?.localUIRight === true, u?.localUIRight);
    ok(
      'эрх сунгахад хуваарь ХЭВЭЭР',
      JSON.stringify(u?.RightPlan) === JSON.stringify(ADMIN.RightPlan),
      u?.RightPlan,
    );
    ok(
      'эрх сунгахад хугацаа шинэчлэгдэв',
      (u?.Valid as Record<string, unknown>)?.endTime === INPUT.endTime,
      u?.Valid,
    );
  }

  console.log(fails ? `\n${fails} шалгалт унав` : '\nБүгд тэнцэв');
  process.exit(fails ? 1 : 0);
})();
