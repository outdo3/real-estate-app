# TRANSACTIONS API TRUST V1 — /api/transactions 과소집계 감사

작업일: 2026-09-08
시작 HEAD: `9a35d50` (docs: record the V2.1 Production visual QA)

## 목적

`/api/transactions`가 원본 조회 일부가 실패했을 때 조용히 과소집계할 수 있는지 확인하고,
가능하면 안전하게 닫는다. 주 소비자는 평당가 분위 지도(PriceMapView)다.

## 1. 라우트 구조

두 경로가 있고, 완전성 성격이 전혀 다르다.

| | 경로 A (DB-first) | 경로 B (MOLIT live) |
|---|---|---|
| 조건 | `type=apt` + `months=12` + dong/loadMore 없음 + **lawdCd가 26(부산)** | 그 외 전부 |
| 원천 | `apartment_trade_histories` (Prisma) | MOLIT 실시간 |
| 조회 수 | 1 쿼리 | **월 수만큼 병렬**(12개월이면 12회) |
| 동시성 제어 | 해당 없음 | **없음** (`molit-stats-helpers`의 전역 세마포어를 타지 않는다) |
| 실패 방식 | throw → 500 | **throw하지 않음** — 에러 플레이스홀더 1행 반환 |
| 캐시 | `getOrSetCache` 30분 (실패는 throw라 캐시 안 됨) | 라우트 캐시 없음. `fetchMolitData`의 `next:{revalidate:3600}` |
| 재시도 | 없음 | 없음 |
| 타임아웃 | 없음(DB 기본) | `AbortSignal.timeout(5000)` |

호출부는 3곳 전부 정확히 같은 모양(`type=apt&lawdCd=X&months=12`)을 쓴다. 즉 **부산은 A,
그 외 지역(서울 등)은 전부 B**를 탄다.

## 2. 소비자

| 소비자 | 파생값 | 완전성 인지(변경 전) | 부분 데이터가 결과를 바꾸는가 |
|---|---|---|---|
| `stats/[type]` PriceMapView | 평당가 **5분위 색상/순위** | X | **예 — 결정적** |
| `map/page.tsx` | 단지별 최신 거래 마커 | X | 예 (마커 누락/구가격) |
| `ai-search` runConditionSearch | 조건 충족 단지 목록 | X | 예 (목록이 짧아짐) |

## 3. 변경 전 실패 의미론 — 조용한 과소집계 **YES**

`fetchMolitData`는 실패해도 throw하지 않고 `typeLabel:'에러'` 1행을 반환한다. 이전 코드는

```js
const results = await Promise.all(promises);
data = results.flat();          // ← 에러 플레이스홀더가 그대로 섞인다
```

로 그 행을 응답 배열에 그대로 실어 보냈고, 소비자는 좌표/평형이 없다는 이유로
(`if (!t.lat || !t.lng || !t.pyung) return;`) 조용히 걸러냈다. 결과적으로

- **N개월 실패 = N개월 무거래**와 화면상 완전히 동일
- 응답이 bare array라 완전성을 담을 자리 자체가 없음

12개월을 동시에, 게이팅 없이 호출하는 경로라 초당 제한에 걸리기 쉽다 — 이론적 위험이
아니라 실제로 일어날 수 있는 과소집계였다.

분위 지도에서 특히 치명적인 이유: 분위는 **불러온 것들 사이의 상대 순위**다. 거래가
빠지면 5등분 경계가 이동해 같은 단지가 다른 색으로 칠해진다. 색이 이 화면의 결론이다.

## 4. 검증된 0건 의미론

경로 A: 단일 쿼리가 성공했는데 행이 0건 → **검증된 0건**(완전). 실패는 예외로 드러난다.
경로 B: 성공 응답 + 그 달 거래 0건(`SUCCESS_EMPTY`) → 완전. `FAILED`와 반드시 구분된다.

## 5. 완전성 계약

새 의미를 만들지 않고 기존 것을 그대로 재사용했다.

- 서버: `/api/apt/[name]`이 이미 쓰는 `classifyMolitMonthResult` / `foldMonthResults` /
  `summarizeTradeCompleteness`
- 응답: bare array → envelope
  `{ transactions, partial, failedMonths, monthsRequested, monthsSucceeded }`
- 클라이언트: `resolveTransactionsReadState()` (trade-read-state.ts, 기존 계약 가족)

**하위 호환**: 리더는 배열도 계속 받아들여 "예전 계약 = 완전"으로 읽는다. 배포 중
서버/클라이언트 버전이 잠시 어긋나도 화면이 깨지지 않는다.

경로 A는 `partial:false, 12/12`로 고정한다 — 단일 쿼리라 부분 상태가 존재하지 않는다.

## 6. 혼합 커버리지 판단

이 라우트는 요청당 시/군/구 하나만 다루고, PriceMapView도 한 번에 한 구만 그린다.
실패 단위는 **월**이라 그 구 전체에 동일하게 영향을 준다.

→ **불완전한 마커만 골라 제외하는 것은 불가능하다.** 빠진 달의 거래가 어느 단지 것이었는지
알 수 없기 때문이다(빠진 것은 보이지 않는다). 그래서 개별 제외 대신 **구 전체를
불완전으로 표시**한다. "최대 마커 수보다 정확성 우선"(§6) 지시와 일치한다.

## 7. 화면 동작

**PriceMapView (분위 지도)**
- 완전: 기존 그대로 — 5분위 색상 + 범례.
- 불완전: 분위 색을 **중립 회색 하나(#94a3b8)**로 대체, 범례를 안내 문구로 교체,
  카드 설명도 "거래 위치만 표시"로 바꾼다(색을 약속하는 문장이 남으면 모순).
  마커는 지우지 않는다 — 실제로 일어난 거래이고, 신뢰할 수 없는 것은 "몇 분위인가"라는
  상대 판단이지 거래 사실이 아니다. 툴팁의 평당가도 그대로 남긴다.

**map/page.tsx**
- 기존 `aptNotice`(info/error) 체계를 그대로 쓴다. 오피스텔과 공유하는
  `OfficetelLayerStatus` 타입은 건드리지 않고 아파트 전용 `aptPartial` 플래그를 따로 뒀다.
- 60초 마커 캐시에 `partial`을 **함께** 저장한다 — 플래그 없이 markers만 캐시하면 캐시
  히트에서 불완전이 완전으로 되살아난다(§7 정확히 그 경로).

**ai-search 조건검색**
- 반환 타입을 `ConditionSearchResult { complexes, partial, unavailable }`로 바꿨다
  (모듈 전역 변수로 두면 동시 요청끼리 서로의 상태를 덮어쓴다).
- 빈 목록의 이유를 구분한다: 조회 실패 / 부분 실패 / 진짜 없음.
- 부분 실패면 브리핑 입력에 "전부라고 단정 금지"를 명시한다(regional_stats와 같은 규칙).

## 8. 캐시 안전성

| 요구 | 결과 |
|---|---|
| FAILED가 성공 캐시를 오염시키지 않는다 | 경로 A는 throw라 `store.set` 이전에 중단 → 캐시 안 됨. 경로 B는 라우트 캐시 자체가 없음 |
| SUCCESS_EMPTY는 정상 캐시 | 경로 A에서 그대로 캐시(진짜 0건은 실패가 아니다) |
| PARTIAL이 COMPLETE로 둔갑하지 않는다 | 지도 마커 캐시에 partial 동반 저장으로 차단 |
| 정상 캐시가 일시 실패로 덮이지 않는다 | 기존 `getOrSetCache` 동작 그대로(변경 없음) |

전역 캐시 동작은 바꾸지 않았다(§7 지시).

## 9. 보안

- 응답 body는 원래부터 고정 문구(`{error:'Failed to fetch data'}`) — 유출 경로 아님.
- 에러 플레이스홀더의 메시지는 `fetchMolitData`가 이미 마스킹하고 있었고, 이번 변경으로
  **응답에서 아예 제거**되므로 더 안전해졌다.
- catch의 `console.error(..., error)`가 원본 객체를 통째로 찍고 있어(이 라우트는 MOLIT과
  DB를 모두 거친다) 공유 마스킹 함수를 통과시키도록 바꿨다.
- Production 실측: 응답에 `serviceKey`/`apis.data.go.kr` 없음.

## 10. 성능

새 외부 호출 0, 새 DB 쿼리 0, 동시성 변경 0. 추가된 일은 이미 메모리에 있는 배열을 한 번
훑는 O(n) 분류뿐이다. PERFORMANCE V2는 열지 않았다.

로컬 실측: 부산 DB 경로 cold 1507ms / warm 270ms, 비부산 MOLIT 경로 cold 1383ms /
warm 1025ms. 지도 렌더 영향 없음(마커 수 동일).

## 11. 테스트

`src/lib/transactions-read-state.test.mjs` — 18개, 전부 PASS.

A(전부 성공) / B(전부 0건) / C(1개월 실패) / D(복수 실패) / E(전부 실패) / F(회복),
envelope 전달, 완전 케이스 무경고, 검증된 0건, 예전 배열 호환, `{error}` 응답,
예상 밖 body, 라우트/분위지도/마커캐시/조건검색 구현 가드, 사용자 문구 내부용어 금지.

E와 B는 거래 0건으로 결과가 같아 보이지만 완전성이 정반대임을 명시적으로 검사한다 —
이 구분이 이 STEP의 핵심이다.

## 12. 검증

```
node --test --experimental-strip-types "src/lib/*.test.mjs"
  → tests 309 / pass 308 / fail 1
```

유일한 실패 `trade-history-read.test.mjs`는 러너가 `@/` 별칭을 해석하지 못하는 기존
인프라 이슈이며 수정 전 HEAD에서도 동일하게 실패한다(이 STEP에서 건드리지 않은 파일).

```
npx tsc --noEmit  → src 신규 오류 0 (전체 24건은 기존 scripts/ 20 + tmp/ 4)
npx eslint src    → 0 errors, 5 warnings (전부 기존)
npm run build     → 성공
```

Production 시각 QA(360/375/390/767/959/1280, 배포된 빌드 대상, 완전성 필드만 되돌린
결정적 fixture):

- 분위 지도 불완전: 마커 색 **1종(중립 회색)**, 범례 숨김, 안내 1회, 가로 overflow 없음,
  실패 월/내부 용어 노출 없음, 마커 7개 유지
- 분위 지도 완전: 5분위 색 5종 전부, 범례 표시, 안내 0회 — 변경 전과 동일
- 지도 불완전: 안내 1회, overflow 없음 / 완전: 안내 0회

## 13. 남은 위험

- **Next Data Cache**: 경로 B는 `next:{revalidate:3600}`를 쓰는데, MOLIT 스로틀링은
  HTTP 200 + 에러 XML로 오므로 그 응답이 1시간 캐시될 수 있다. 이제는 그 상태가
  `partial=true`로 **정직하게 표시**되지만, 회복까지 최대 1시간이 걸릴 수 있다.
  `/api/apt/[name]`는 `force-dynamic` + `fetchMolitMonthCached`로 이미 해결한 문제다.
  같은 처방을 이 라우트에 적용하는 것은 egress/성능 영향이 있어 별도 STEP이 맞다.
- **경로 B에 동시성 게이팅이 없다**(12개 동시 호출). 실패 확률 자체를 낮추는 일은
  동시성 튜닝이라 이 STEP 범위 밖(명시적 금지).
- **DB 동기화 커버리지**: 경로 A의 완전성은 "쿼리를 온전히 읽었다"는 뜻이지
  "DB가 모든 실거래를 갖고 있다"는 뜻이 아니다. 배치 동기화 커버리지는 별개 주제다.
