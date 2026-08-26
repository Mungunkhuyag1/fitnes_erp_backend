# WinFit Backend

NestJS 11 + TypeORM + PostgreSQL. Тодорхойлолт: [`../docs/05-backend-api.md`](../docs/05-backend-api.md)

## Хөгжүүлэлт эхлүүлэх

```bash
cp .env.example .env        # DATABASE_URL, JWT_SECRET-ээ тохируулна
createdb winfit
npm install
npm run migration:run
npm run start:dev           # → http://localhost:3100/api
```

| Хаяг | Юу |
|---|---|
| `/api/health` | Апп амьд эсэх |
| `/api/health/deep` | DB + gateway горим |
| `/api/docs` | Swagger UI |
| `/api/openapi.json` | OpenAPI |

> Порт **3100** — Loopy (3000)-тэй зэрэг ажиллахад мөргөлдөхгүй.

## Gateway горим

Гурван гадаад хамаарлыг `.env`-ийн нэг мөрөөр солино
([05-backend-api.md §6](../docs/05-backend-api.md)):

```bash
DEVICE_GATEWAY=stub   # stub | agent   — Hikvision терминал
LOOPY_MODE=stub       # stub | live    — Wallet карт
BONUM_MODE=stub       # stub | live    — төлбөр
```

Stub нь **эвдрэлийг дуурайлгана** (`STUB_FAILURE_RATE`, `STUB_DEVICE_OFFLINE`)
— outbox retry, алдааны дэлгэц, offline анхааруулгыг жинхэнэ төхөөрөмжгүйгээр
турших боломж өгнө.

Production дээр аль нэг нь `stub` байвал апп **асахаас татгалзана**
(`main.ts` → `assertNoStubInProd`).

## Дүрмүүд

1. Схемийн өөрчлөлт **зөвхөн migration**-аар. `synchronize` хэзээ ч `true` биш
2. Огнооны бүх тооцоолол `common/utils/date.util.ts`-ээр — локал өдрийн хилтэй
3. Сунгалтын огноо тооцох дүрэм **ганц газарт**: `computeNewEndsAt()`
4. `member`/`membership` модуль нь `device`/`loopy`-г шууд дуудахгүй — `outbox`-оор
