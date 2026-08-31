# TRADE DB FIRST V1 — STEP A: 실거래 DB Read Core 구축

## 1. 목적

Production DB에 이미 구축된 부산 전체 실거래 이력(`ApartmentTradeHistory`,
855,000+ rows, 16/16 구·군, 2006-01~)을 향후 사용자 실거래 분석 기능
(84㎡ 순위/거래량/최근 상승·하락/지역 변동지도 등, STEP B~D)이 **공통으로
재사용할 수 있는 안정적인 DB 읽기 기반**을 완성한다. 이번 STEP 자체는
어떤 눈에 보이는 새 기능도 추가하지 않는다 — 기존 84㎡/거래량/상승/
하락/변동지도 API를 이 core로 전환하는 작업은 별도 후속 STEP
(`TRADE_HISTORY_READ_MIGRATION_V1`)이다.

## 2. Architecture

```
MOLIT / 공공데이터
        ↓
이집 수집 시스템(backfill-trade-history.ts / sync-trade-history.ts)
        ↓
apartment_trade_histories (Production DB, 영구 저장)
        ↓
src/lib/trade-history-read.ts ← 이번 STEP이 확장한 공통 read core
        ↓
(향후) 이집 API → 사용자
```

**절대 원칙(재확인)**: 사용자 화면 요청 경로에서 MOLIT API를 직접
호출하지 않는다. 이번 STEP의 read core(`trade-history-read.ts`)는
`fetch()`/`molit-stats-helpers`/`api-molit`/`fetchMolitData` 무엇도
import하지 않는다 — `src/lib/trade-history-read.test.mjs`의
`NO_MOLIT_FALLBACK` 테스트가 매 실행마다 이를 정적으로 재확인한다
(주석이 아니라 실제 `import` 구문만 검사, 우회 불가능).

## 3. Audit 요약

바로 새 repository를 만들지 않고 기존 구조부터 조사했다:

- `src/lib/trade-history-read.ts`(`TRADE_HISTORY_DATA_V1` §33/§34가 이미
  만들어 둔 파일) — `getTradeHistory`/`getAllTimeHigh`/`getPreviousTrade`/
  `getRegionalTrades` 4개 좁은 헬퍼가 이미 존재했다. STEP A 시작 시점
  (main `60b27c3`)까지 이 파일은 **어떤 live API route에서도 import되지
  않은 상태**(`scripts/qa-trade-history.ts`만 사용)였다 — grep으로 재확인.
- `src/lib/regional-feed.ts` — `identityKey()`/`areaKey()`/`groupKey()`
  (aptSeq 우선/name+dong 폴백)가 canonical identity 정의. 새로 만들지
  않고 그대로 재사용.
- `scripts/trade-history-logic.ts` — backfill 시점 정규화 로직(쓰기
  경로). `dealAmount`가 DB에 이미 `Int`(만원 단위)로 저장돼 있어, 읽기
  경로에서는 문자열 금액 파싱이 필요 없음을 확인(§16 관련 audit 결론).
- `scripts/benchmark-trade-history.ts` / `scripts/qa-trade-history.ts` —
  기존 벤치마크/QA 스크립트. §QA-FIX(Decimal exact-match를 문자열로
  비교해야 하는 이유)가 이미 실측·수정돼 있었고, 이번 STEP의 새 함수도
  동일 원칙을 그대로 따른다.
- `data/trade-history/busan-manifest.json` — 구·군×연월별 backfill
  completeness 기록(status/fetched/persisted/…, 3,968 keys, 2006-01~
  2026-08). 재사용 가능성을 조사했으나, 이번 STEP의 read core는 요청마다
  DB에서 직접 `MAX(dealDate)`를 계산하는 편이 더 정확하고(파일 동기화
  누락 위험 없음) 비용도 낮아(인덱스된 aggregate) 이 파일을 core 자체가
  읽지는 않기로 결정 — 대신 §19 metadata 설계에 그대로 반영(아래 §7).
- **버그 수정(안전, 시그니처 불변)**: `trade-history-read.ts`가 자체
  `new PrismaClient()`를 만들고 있었다(이 프로젝트의 나머지 코드가 전부
  쓰는 `src/lib/prisma.ts`의 전역 싱글턴을 안 씀) — 이번 세션에서 이미
  겪은 Supabase session-mode connection pool 고갈 문제(§6)와 직접
  연관되므로, 이번 STEP 범위 안에서 안전하게 싱글턴으로 교체했다(기존
  4개 함수의 동작/시그니처는 전혀 바뀌지 않음).

## 4. 구현

### 4-1. 신규 공통 진입점: `queryTrades()`

```ts
import { queryTrades } from '@/lib/trade-history-read';

const result = await queryTrades({
  lawdCd: ['26110', '26140', /* ...16개 구 */],
  exclusiveAreaRange: { gte: 84, lt: 85 },
  from: twelveMonthsAgo,
  limit: 500,
});
// result.trades: StoredTrade[]
// result.meta: { dataSource:'DB', requestedRange, returnedCount, limitApplied,
//               possiblyTruncated, latestDealDate, includeCanceled }
```

기존 4개 함수(`getTradeHistory`/`getAllTimeHigh`/`getPreviousTrade`/
`getRegionalTrades`)는 **변경하지 않고 그대로 유지**한다(§27 — 기존
API/헬퍼를 한꺼번에 갈아끼우지 않음, `qa-trade-history.ts` 그대로 동작
재확인 완료). `queryTrades()`는 이들을 대체하지 않는 **일반 조합형 진입
점**으로, STEP B~D가 각자 좁은 헬퍼를 새로 만드는 대신 공통으로 쓸 수
있게 설계했다.

순수 함수 `buildTradeQuery(input)`(DB 접근 없음, Prisma
where/orderBy/take만 조립)와 그 결과를 실행하는 async
`queryTrades(input)`으로 분리해, 쿼리 조립 로직 자체를 DB 없이 단위
테스트할 수 있게 했다(프로젝트 기존 관례 — 순수 로직 파일 분리).

### 4-2. Query input

| 필드 | 의미 | 정책 |
|---|---|---|
| `aptSeq` | 단일 또는 배열(batch) | canonical identity 최우선(§13) |
| `identity` | `{aptSeq, name, dong}` | aptSeq 없는 단지의 name+dong 폴백. `aptSeq`와 동시 지정 시 `aptSeq`가 우선(AND로 겹쳐 걸지 않음) |
| `lawdCd` | 단일 또는 배열(batch) | 부산 16개 구 전체 조회 시 배열로 IN 쿼리 |
| `exclusiveArea` | 정확 일치 | **문자열로 변환해 비교**(§QA-FIX, Decimal float 직렬화 오매칭 방지) |
| `exclusiveAreaRange` | `{gte,gt,lt,lte}` bounded | 숫자 그대로 사용(등가비교가 아니므로 안전 — benchmark-trade-history.ts scenario4로 이미 실측 확인된 패턴) |
| `from`/`to` | `dealDate` 기준 | **둘 다 inclusive**. `dealDate`가 `@db.Date`(시각 없음)이므로 자정 기준 Date를 넘길 것 |
| `includeCanceled` | 기본 `false` | 유효 거래 분석은 항상 취소 제외. forensic/admin만 명시적 `true` opt-in(§11 — caller가 매번 기억해야 하는 구조 금지) |
| `orderDirection` | 기본 `'desc'` | `dealDate` + `id` 2단 정렬로 deterministic(§17, 동일 날짜 tie-break) |
| `limit` | 선택 | `MAX_TRADE_QUERY_LIMIT`(5000)으로 clamp. **생략하면 take 없음** — aggregation 용도로 전체 반환을 의도적으로 허용(§18) |

**안전장치**: `aptSeq`/`identity`/`lawdCd` 중 최소 하나도 없으면
`TradeQueryValidationError`를 던진다 — "조건 없이 855,000+ rows 전체
스캔"이 애초에 만들어질 수 없다(§18). `exclusiveArea`와
`exclusiveAreaRange`를 동시에 주는 것도 명시적으로 금지(모호성 방지).

### 4-3. No-fallback / No-data 정책

DB 결과가 0건이면 정직하게 빈 배열(`trades: []`,
`meta.returnedCount: 0`, `meta.latestDealDate: null`)을 반환한다. 다른
단지/다른 기간 데이터로 대체하지 않는다(§21, 실측 QA F 케이스로 확인).

### 4-4. Completeness / Freshness metadata(§19)

이번 STEP은 새 DB table을 만들지 않는다. 대신 `queryTrades()`가 매 호출마다:

- `dataSource: 'DB'` — 항상 DB 전용임을 명시(향후 다른 source가 생겨도
  구분 가능하도록).
- `latestDealDate` — **반환된 배열에서 유추하지 않고** 동일 where
  조건에 대한 별도 `aggregate({_max:{dealDate}})`로 계산한다(limit/정렬
  방향과 무관하게 항상 정확 — limit이 걸려 반환 배열이 잘렸거나
  `orderDirection:'asc'`여도 왜곡되지 않음).
- `possiblyTruncated` — `returnedCount === limitApplied`일 때만 true.
  호출부가 "이게 전체다"라고 오해하지 않도록.

`COMPLETE`/`PARTIAL`/`INVALID` 같은 상위 분류는 이번 STEP에서 만들지
않았다 — 위 4개 필드가 그 분류를 나중에 계산할 수 있는 최소 재료를
이미 제공한다(§19 "향후 연결 가능하도록"의 의도 그대로).

### 4-5. Cancellation correctness 경계(§28)

최근 13개월 취소거래 correctness는 `TRADE_CANCELLATION_RESYNC_V1`이
검증했지만, 전체 기간(2006~) 취소 completeness는 완전히 검증되지
않았다. `queryTrades()`가 취소 거래를 정확히 제외하는 것과, 그 결과가
"역대 최고가"라고 부를 만큼 완전하다는 것은 별개다 — 이번 STEP은 read
core만 만들고, "역대"류 표현의 UI 노출 여부는 호출부(STEP B~D) 책임으로
남긴다(`getAllTimeHigh`의 기존 주석과 동일 원칙).

## 5. Index Audit(§23)

기존 인덱스(schema 변경 없이 그대로 사용):

```prisma
@@index([aptSeq, exclusiveArea, dealDate])
@@index([lawdCd, dealDate])
@@index([identityKey, dealDate])
@@index([dealDate])
```

`queryTrades()`가 만드는 4가지 필터 조합(aptSeq, identity, lawdCd,
lawdCd+area+date)이 전부 위 인덱스 중 하나 이상과 정확히 일치한다 —
**이번 STEP에서 신규 인덱스가 필요하지 않았다**(`SCHEMA_CHANGE_
RECOMMENDED` 아님). §25 벤치마크에서 확인된 유일한 느린 케이스(§6-4)는
인덱스 부재가 아니라 "16개 구 전체 × 12개월, 필터 없이 3.7만 row raw
반환"이라는 쿼리 형태 자체의 데이터 전송/직렬화 비용이다(index는 이미
사용되고 있음 — area filter를 추가한 동일 범위 조회가 2.2초로 즉시
줄어드는 것으로 간접 확인).

## 6. Production Benchmark(2026-08-31 실측)

`scripts/qa-trade-history-read-core.ts`(read-only, DB 쓰기 없음) 실행:

| # | 시나리오 | cold | warm | 목표 대비 |
|---|---|---|---|---|
| 1 | 단일 단지 최근 거래(aptSeq, limit=50) | 124ms | 45ms | PASS(<1s 목표 여유 있게 충족) |
| 2 | 구 단위(서구 26140) 최근 12개월 | 212ms | 151ms | PASS(<1s 목표 충족) |
| 3 | 부산 전체 16개 구 최근 12개월, 84㎡대(STEP B 입력 형태) | 2,189ms | 2,371ms | PASS("전국/무거운 계산 <3초" 목표 충족) |
| 4 | 부산 전체 16개 구 최근 12개월, area 필터 없음(최대 부하 stress test) | 6,334ms | (측정 안 함) | **목표 초과**(5초 최적화 검토 구간, 10초 FAIL 아님) |

시나리오 4는 `benchmark-trade-history.ts`(직전 STEP)가 동일 패턴으로
이미 측정한 6,799ms와 사실상 일치 — 새로 발견된 회귀가 아니라 기존에
문서화된 특성의 재확인이다. 이 패턴(지역 전체 × 장기간 × 필터 없음)은
STEP A가 어떤 live route에도 연결하지 않으므로 사용자에게 노출되지
않는다. **STEP B(거래량) 설계 가이드**: 이 형태의 요청은 raw row
배열보다 `groupBy`/`count` aggregate로 바꾸는 것을 권장 — 이번 STEP은
이 권장사항만 기록하고 실제 aggregate 헬퍼 구현은 STEP B 범위로 남긴다
(premature하게 미리 만들지 않음, §27).

## 7. Tests

`src/lib/trade-history-read.test.mjs`(신규 19개, `npx tsx --test`):

- A: 단일 aptSeq → `where.aptSeq`
- B/B-2: `includeCanceled` 기본 false / opt-in true
- C: from/to → `dealDate.gte/lte`, `requestedRange` 문자열 변환
- D/D-2/D-3: exact area(문자열 변환) / range area(숫자 그대로) / 동시 지정 시 검증 에러
- E/E-2: `lawdCd`/`aptSeq` 배열 → `{in: [...]}`(batch, N+1 방지)
- F/F-2/F-3: scoping 없으면 검증 에러 / identity 폴백 / aptSeq가 identity보다 우선
- G/G-2: 기본 정렬 `dealDate desc + id desc`, `orderDirection` 방향 일관성
- H~H-4: limit clamp / limit 생략 시 무제한 / 잘못된 limit 값 검증 / `dealType` 항상 `'sale'`
- `NO_MOLIT_FALLBACK`: import 구문 정적 감사(MOLIT fetch 헬퍼 참조 0)

`scripts/qa-trade-history-read-core.ts`(신규, Production DB 실측,
read-only) — §24 A~H 전체를 실제 데이터로 재확인(18/18 PASS) + §25
벤치마크(위 §6).

세션 전체 회귀: `npx tsx --test`(신규 19개 포함) **691/691 PASS**.
기존 `scripts/qa-trade-history.ts`(문서화된 정식 invocation으로) 재실행
— 8개 대표 단지 전부 라이브 MOLIT 매칭 OK, 기존 4개 함수 동작 완전히
동일(회귀 없음).

## 8. Test / Build

- `npx tsc --noEmit`: 20건(기존 baseline과 정확히 동일, 신규 오류 0).
- `npx eslint src/lib/trade-history-read.ts scripts/qa-trade-history-read-core.ts`: clean.
- `npm run build`: PASS.

## 9. Known Limitations

- `queryTrades()`는 아직 어떤 live API route에서도 import되지 않는다
  (§27 — 의도적, 이번 STEP 범위 밖). STEP B~D가 실제로 전환할 때까지
  사용자에게 미치는 영향은 0이다.
- 전체 기간 취소(cancellation) completeness는 최근 13개월만 검증됐다
  (§5, §28) — read core 자체의 한계가 아니라 데이터 completeness의
  경계이며, 호출부가 "역대" 표현을 쓸 때 반드시 인지해야 한다.
- 시나리오 4(§6) 같은 "지역 전체 × 장기간 × 무필터" 패턴은 raw row
  반환 방식으로는 6초대가 나온다 — STEP B가 거래량 기능을 구현할 때
  aggregate 방식을 우선 검토할 것을 권장(§6 가이드).
- `busan-manifest.json` 기반의 "구·군×연월 단위 backfill 완료 여부"는
  이번 STEP의 read core metadata에 통합하지 않았다(§3) — 필요해지면
  별도 조사 대상.

## 10. STEP B 연결 방식

STEP B(84㎡ 국민평형 순위 + 거래량)는:

```ts
// 84㎡ 순위 입력
const { trades } = await queryTrades({
  lawdCd: BUSAN_LAWD_CODES,
  exclusiveAreaRange: { gte: 84, lt: 85 },
  from: twelveMonthsAgo,
});

// 거래량(aggregate 권장, §6 가이드 — STEP B에서 실제 구현)
```

처럼 `queryTrades()`를 그대로 가져다 쓰거나, 거래량처럼 aggregate가
더 적합한 경우 `buildTradeQuery()`가 만든 `where` 절을 재사용해 별도
`groupBy`/`count` 헬퍼를 STEP B 범위에서 추가하면 된다 — identity/
cancellation/area 정책을 다시 구현할 필요가 없다.
