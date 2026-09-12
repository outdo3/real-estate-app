# BUSAN 12M STATS PERFORMANCE FIX V1

**상태: 구현 완료 / DB schema·migration 0건 / Production write 0건 / cron·새 인프라 0건**

작성일 2026-09-12 · branch `main` · 기준 HEAD `25bf6d1`

---

## 1. 목적

`GET /api/stats/feed?sidoCode=26&period=12m`(통계 → 실거래 피드 → "부산광역시 전체" +
"최근 12개월")의 **실제 백엔드 실행 비용**을 줄인다.

로딩 문구로 가리는 작업이 아니다. 직전 STEP(STATS_LOADING_STATE_UX_FIX_V1)에서 false-empty를
없앤 뒤에도 이 요청은 여전히 22~25초가 걸렸고, 그건 UI 문제가 아니라 **한 요청이 외부 API를
384번 호출**하는 구조 문제였다.

금지 사항을 그대로 지켰다: TTL 늘리기나 12개월 옵션 제거를 해결책으로 쓰지 않았고, DB
schema/migration·production write·통계 공식·기간 옵션·데이터 최신성 기준·cron을 건드리지 않았다.

---

## 2. 시작 상태 (safe mode)

```
branch            main
HEAD              25bf6d1  feat(home): hide the conditional-search entry behind a feature flag
tracked dirty     package.json, package-lock.json   (사용자 작업물 — 건드리지 않음)
```

`git stash` / `git clean` / `git reset` / `git checkout .` 미사용. 사용자 untracked 작업물
(`tmp/`, `scripts/audit-apt-trade-*.ts`, `scripts/officetel/*`, `my_prod.html`,
`prisma/schema_old.prisma`, `.claude/settings.local.json`, `ApartmentAutocomplete.tsx.bak`)
전부 그대로 보존했다. DB는 SELECT만, MOLIT은 GET만 했다.

---

## 3. §1 실행 경로 감사 — 22초는 어디서 왔는가

### 3.1 요청 하나가 만드는 외부 호출 수 (추정 아님, 계측)

`scripts/audit-stats-feed-12m-latency.ts` 실측:

```
now               2026-09-12T13:16:39Z
periodRange       2025-10-01 ~ 2026-09-12
months            12   (202510 … 202609)
districts         16   (regcode proxy 217ms)
MOLIT tasks       384  = 16 × 12 × 2
```

- **이론값 384 = 실제값 384.** pagination으로 늘어나지도, 중복 호출되지도 않는다.
  (`fetchMolitData`는 `numOfRows=1000` 단일 페이지 고정이고, 현재 창의 어떤 구-월도
  900행에 닿지 않는다 — RENT PHASE D §8에서 이미 확인된 사실.)
- 숨은 추가 호출: `getSigunguListForSido`(법정동코드 프록시) **1회**.
  `§39 apiError 프로브`는 단일 구 경로 전용이라 시도 전체에서는 호출되지 않는다.
- 재시도: `fetchMonthWithRetry`가 실패 셀에만 1회 추가(정상 시 0). 즉 384가 하한이자
  정상값이다.

### 3.2 왜 384가 곧 22초인가

`molit-stats-helpers.ts`의 전역 스로틀은 **동시 6개**이고, 각 슬롯은 응답을 받은 뒤에도
**200ms를 쥔 채로** 유지한다(MOLIT 초당 요청 제한 회피, 실측으로 굳힌 값).

```
벽시계 ≈ (평균 호출시간 + 200ms 페이싱) × 384 / 6
```

Production 실측 22.39s를 이 식에 넣으면 평균 호출시간 ≈ **150ms**가 나온다
(`(150+200) × 384 / 6 = 22,400ms`). 즉 **22초의 거의 전부가 MOLIT 대기이고, 그 크기는
호출 수에 정비례한다.** 캐시(`getOrSetCache`, 인스턴스 메모리, TTL 5분, `force-dynamic`)가
비는 순간마다 22초가 그대로 재발한다 — 실측에서 25.46s → 0.93s → (몇 분 뒤) 22.39s.

### 3.3 단계별 시간 (고친 뒤, `scripts/audit-stats-feed-12m-stages.ts`)

로컬(개발 PC → Supabase) 실측:

| 단계 | ms |
|---|---|
| `getSigunguListForSido` (외부 HTTP 1회) | 161 |
| `getRentVerifiedRange` (coverage 1 query, 5분 캐시) | 173 |
| fetch 단계 전체(아래 둘 병렬) | **3,009** |
| └ MOLIT 16 tasks (검증 안 된 월의 전월세만) | 1,320 |
| └ DB sale 34,914 + rent 52,146 rows (2 query 병렬) | 3,009 |
| `toFeedTrade` 조립 (87,803건) | 1 |
| `dedupeTrades` (→ 83,216) | 74 |
| `annotateTrades` (신고가/직전거래) | 164 |
| `buildRegionSummary` | 47 |
| 해석문 + 동/면적 집계 | 52 |
| 정렬 + 페이지 슬라이스 | 84 |
| `resolveApartmentContextBatch` (페이지 50건) | 123 |
| **TOTAL** | **3,888** |

**집계 연산(JS)은 병목이 아니다 — 8만 건을 다 돌려도 합계 0.5초 미만이다.** 남은 병목은
row 전송이고, 로컬은 대역폭 한계다(sale 단독 1,267ms / rent 단독 2,066ms / 병렬 2,830ms —
합보다 조금만 빠름 = transfer-bound. 커넥션 풀 문제가 아니다).

---

## 4. §3 DB coverage 감사 (읽기 전용) — 브리프의 5개 질문

| 질문 | 답 | 근거 |
|---|---|---|
| 1. sale 12m은 DB-only 가능? | **가능** | `apartment_trade_histories`: 창 안 34,914행, **16/16 구**, `aptSeq` NULL 0건. 매일 sync + 3.2일 주기 회전 recheck. 같은 데이터를 이미 `/api/transactions` DB-first·`/api/stats/dashboard`·지도 마커·분위지도가 읽는다 |
| 2. rent 12m은 DB-only 가능? | **부분 가능 — 검증범위 안 월만** | `apartment_rent_histories`: 검증범위 `202408~202608`(coverage cell 기준). 창의 12개월 중 **11개월이 verified**(52,146행, 16/16 구), 남은 1개월(`202609`, 진행 중인 현재월)은 검증 대상이 아니라 **MOLIT으로 계속 조회** |
| 3. 왜 MOLIT을 호출했나? | 이 라우트만 DB-first 전환에서 빠져 있었다 | `dashboard`/`transactions`/`yearly`는 이미 부산을 DB로 읽는다. `feed`는 STATISTICS V2 시절 구조(월 단위 MOLIT 배치)를 그대로 유지하고 있었다 — 데이터가 없어서가 아니라 **전환이 안 돼 있어서** |
| 4. 기존 DB 쿼리 helper 재사용 가능? | **가능** | 전월세는 `fetchRentMonthBucketsFromDb()`를 **그대로 재사용**(새 SQL 0줄). 매매는 좁은 전용 fetcher 1개 추가 — 이유는 §5.2 |
| 5. cancellation trust 유지 가능? | **가능** | `deal_canceled` 컬럼을 그대로 읽어 `dealCanceled`로 넘긴다. SQL에서 취소를 지우지 않는다(피드는 취소 거래를 배지와 함께 보여주고 집계에서만 뺀다) |

---

## 5. §4 옵션 평가와 선택

| 옵션 | 판정 | 이유 |
|---|---|---|
| **A. DB-first aggregation** | **채택** | 부산 데이터가 이미 DB에 있고, 같은 요청을 이미 DB로 처리하는 경로(dashboard)가 운영 중이다. 호출 수를 384 → 16으로 줄인다 |
| **B. Hybrid (DB + 부족분만 MOLIT)** | **함께 채택** | 전월세 검증 안 된 월(`202609`)만 MOLIT. "검증 안 된 기간을 DB complete로 가장하지 않는다"는 기존 규칙(RENT PHASE D §16/§17)을 그대로 쓴다 |
| C. 요청 수준 중복 제거 | 불필요 | 감사 결과 중복 호출 0건(§3.1). 고칠 중복이 없다 |
| D. bounded parallelism 조정 | **거부** | 동시성을 올리면 MOLIT 초당 제한에 걸려 `failedDistricts`가 늘고 **데이터가 조용히 줄어든다**. 과거에 이미 겪어 6으로 굳힌 값이다. 호출 수를 줄이는 게 옳고, 줄인 뒤엔 동시성이 병목이 아니다 |
| E. 캐시 구조 변경 | **부분 채택(의미 불변)** | TTL은 5분 그대로. 캐시에 담는 값만 "MOLIT raw 맵" → "조립·중복제거까지 끝난 목록"으로 바꿨다(warm 응답에서 조립을 다시 하지 않음). 외부 캐시·revalidate·TTL 확대 없음 |
| F. 사전 집계(materialized view/cron) | **거부(승인 필요 항목)** | 새 테이블/뷰/cron은 STOP 목록이다. A+B만으로 목표를 달성하므로 제안만 남긴다 |

---

## 6. §5 DATA TRUST GATE — 대조 결과

### 6.1 셀 단위 대조 (`scripts/audit-stats-feed-12m-parity.ts`)

라우트가 실제로 쓰는 함수(`fetchMolitData` / `toFeedTrade` / `dedupeTrades` / `groupKey`)를
그대로 호출해서 비교했다. 감사 전용 규칙을 새로 만들지 않았다.

```
cell          | type | MOLIT |    DB | onlyMOLIT | onlyDB
26350:202608  | sale |   257 |   257 |         3 |      3     (취소 플래그만 다름)
26350:202608  | rent |   459 |   460 |         0 |      1
26110:202603  | sale |    23 |    23 |         0 |      0
26110:202603  | rent |    24 |    23 |         1 |      0
26440:202512  | sale |   135 |   135 |         0 |      0
26440:202512  | rent |   717 |   717 |         0 |      0
26710:202510  | sale |   155 |   155 |         0 |      0
26710:202510  | rent |   405 |   405 |         0 |      0
deduped totals  MOLIT 2175  DB 2175  delta 0
```

### 6.2 부산 전체 A/B (`scripts/audit-stats-feed-12m-ab.ts`)

구 단위로 먼저 비교했다(RENT PHASE D §8 교훈: 부산 전체 동시 버스트는 MOLIT 응답을
일시적으로 과소 반환해 대조 자체를 오염시킨다). 응답에 실제로 실리는 필드 기준:

| 필드 | OLD(MOLIT 384) | NEW(DB+MOLIT 16) | delta |
|---|---|---|---|
| `summary.totalCount` | 83,296 | 83,216 | **−80 (−0.096%)** |
| `summary.verifiedCount` | 82,698 | 82,602 | −96 |
| `summary.cancelledCount` | 598 | 614 | +16 |
| `summary.recordHighCount` | 12,370 | 12,444 | +74 |
| `summary.riseCount` | 26,261 | 26,380 | +119 |
| `summary.fallCount` | 24,890 | 24,538 | **−352 (−1.4%)** |
| `pagination.total` | 83,296 | 83,216 | −80 |
| 첫 페이지 10건 | — | — | **완전 동일(순서·금액·계약일·층·취소 포함)** |
| `topDongs` 상위 5 | 동일 순서 | 동일 순서 | 건수만 ±0.4% |

### 6.3 7개 신뢰 항목 판정

| 항목 | 판정 | 근거 |
|---|---|---|
| 계약일 | **동일** | `deal_date`는 계약일이고 `deal_ymd`와 불일치 0건(사전 감사). `dealDate` 문자열 포맷도 `YYYY-MM-DD` 동일 |
| 취소 제외 규칙 | **동일** | 취소 행을 SQL에서 지우지 않고 `dealCanceled`로 넘긴다. 집계 제외는 기존 `filterVerifiedTrades()`가 그대로 담당 |
| 단지 identity | **동일(오히려 강함)** | DB `aptSeq` NULL 0건 → `identityKey`가 항상 `id:` 형태. 이름 기반 재식별 경로 없음 |
| 매매/전월세 타입 | **동일** | 전월세 타입을 `monthlyRent > 0 ? wolse : jeonse`로 **라우트와 같은 규칙**으로 판정(저장된 `deal_type` 컬럼을 근거로 쓰지 않음 — 근거가 두 개면 언젠가 갈라진다) |
| 구 범위 | **동일** | 같은 regcode 프록시 결과 16개 구로 `lawd_cd = ANY(...)`. 테이블에 있는 부산 밖 132행은 이 필터로 제외 |
| 기간 경계 | **동일** | `monthRangeBounds()`가 MOLIT과 같은 **달 전체** 경계를 만든다(첫 달 1일 ~ 마지막 달 말일). 날짜로 자르면 `annotateTrades`의 비교 대상이 달라진다 |
| 건수/랭킹 semantics | **동일** | dedupe/annotate/summary/정렬/페이지네이션 코드는 한 줄도 바뀌지 않았다. 어댑터가 만드는 것은 `toFeedTrade()`가 먹는 것과 **같은 모양의 raw item**뿐이다 |

### 6.4 남은 차이의 원인 — 확인 후 적용했다

`scripts/audit-stats-feed-12m-diff-cause.ts`로 4개 구(26230/26290/26350/26500)의 차이 행을
방향·타입·월로 분류했다:

```
onlyMOLIT sale            5      onlyDB sale            7
onlyMOLIT rent(verified) 64      onlyDB rent(verified)  1
onlyMOLIT rent(현재월)     0      onlyDB rent(현재월)     0
```

**원인 1 (지배적) — 전월세 지연 등록이 DB에 반영되지 않는다.** 64행 전부 검증범위 안
전월세이고, 특정 신축 단지에 몰려 있다. 직접 확인:

```
26230-2866 (양정포레힐즈스위첸1단지)
  202510  MOLIT 25행 / DB 17행   (8행 누락)
  202511  MOLIT 18행 / DB 15행   (3행 누락)
  202605  MOLIT  7행 / DB  7행   (일치)
```

코드로 근본 원인 확정: `resolveRentRange()`의 기본 overlap은 **2개월**
(`latestComplete-1 ~ latestComplete`)이고, **rent에는 recheck sweep이 없다**
(`vercel.json` cron 3개 = `sale-sync`, `rent-sync`, `sale-recheck`). 즉 완료로 기록된
전월세 월은 **다시 확인되지 않으므로**, 그 뒤 원천에 추가된 계약은 DB에 영구히 들어오지
않는다. 창 전체 기준 규모는 약 **0.1%**다.

> 이것은 이 STEP이 만든 문제가 아니고, **이미 운영 중인 상태**다 — 부산 거래량 dashboard가
> 같은 테이블·같은 검증범위로 전월세를 읽는다. 이번 변경으로 피드가 그 화면과 **같은 숫자**를
> 말하게 된다(전에는 두 화면이 서로 다른 원천을 보고 있었다).

**원인 2 — 매매 취소 플래그 래칫 + 원천 회수 유령 행.** sale 쪽 12행(5 + 7)은
`APARTMENT_TRADE_SYNC_COVERAGE_AUDIT_V1` §7.2/§7.3이 이미 문서화한 기존 데이터 결함이다
(창 안 확정 피해 11행, 테이블 전체 상한 315행 = 0.036%). 지도·분위지도·조건검색은 이미 이
상태를 읽고 있다(그쪽은 취소 행을 아예 버리므로 더 엄격하다).

**원인 3 — `fallCount` −352의 증폭 메커니즘.** 행 차이는 80건인데 하락거래가 352건 줄었다.
`annotateTrades`는 같은 그룹(단지+면적+거래타입)을 날짜순으로 훑으며 **직전 거래와 비교**하므로,
한 행이 빠지면 그 뒤 모든 행의 `previousTrade`가 한 칸씩 밀린다. 누락 64행이 거래가 많은
신축 단지에 몰려 있어 연쇄가 커졌다. 집계 공식 변경이 아니라 **입력 행 차이의 하류 효과**다.

**판정: 적용 가능.** 7개 신뢰 항목 전부 구조적으로 동일하고, 남은 차이는 (a) 원천 coverage
신선도 차이이며 (b) 이미 앱의 다른 화면들이 쓰고 있는 동일 원천이고 (c) 원인이 코드 수준에서
확정됐다. **byte-identical parity를 주장하지 않는다.**

---

## 7. 구현 내용

### 7.1 변경 파일 3개 + 신규 2개

| 파일 | 변경 |
|---|---|
| `src/lib/stats/feed-db-source.ts` | **신규** — DB row → `toFeedTrade()` raw item 어댑터, 부산 판정, 달 경계 계산, 두 쿼리 병렬 로딩 |
| `src/lib/stats/feed-db-source.test.ts` | **신규** — 18 tests |
| `src/lib/trade-history-read.ts` | 피드 전용 좁은 매매 fetcher 1개 추가(기존 함수 무변경) |
| `src/app/api/stats/feed/route.ts` | 시도 전체 분기만 수정. 단일 구 분기는 무변경 |
| `docs/development/CHANGELOG.md` | 기록 |

### 7.2 왜 매매는 기존 `getRegionalSaleRowsRawFromDb`를 재사용하지 않았나

두 가지 **데이터 의미** 차이가 있어 옵션으로 뭉개지 않고 별도 함수로 분리했다
(dashboard의 쿼리 계약·계획을 전혀 건드리지 않는다):

1. 그 함수는 SQL에서 `deal_canceled = false`로 취소를 지운다(지도·dashboard용으로는 옳다).
   피드가 그걸 쓰면 취소 거래가 화면에서 **조용히 사라지고** `cancelledCount`가 0이 된다.
2. 상한(`to`)이 없다. 피드는 MOLIT과 같은 달 경계로 끊어야 `annotateTrades`의 비교 대상이
   같아진다.

추가로 `ORDER BY deal_date, id`를 명시했다. `dedupeTrades`의 키에 `dealCanceled`가 들어가지
않아 같은 (단지·면적·금액·계약일·층) 형제 행 중 **먼저 온 행**이 살아남는데, 정렬을 고정하지
않으면 같은 요청이 실행마다 다른 형제를 남길 수 있다(MOLIT 경로가 실제로 그렇다 — 응답 순서가
호출마다 뒤바뀌는 것이 위 §6.4 원인 2의 근본 원인이다). select는 `toFeedTrade()`가 읽는
컬럼과 1:1로 좁혔다(`build_year`/`jibun` 제외 — 한 요청에 35,000행을 옮기므로).

전월세는 **새 SQL을 한 줄도 쓰지 않았다** — `fetchRentMonthBucketsFromDb()`를 그대로
재사용한다. 그 함수가 자체적으로 검증범위를 한 번 더 강제하므로 이중 안전장치가 유지된다.

### 7.3 `apiError` 판정의 필요한 보정

기존 규칙은 "모든 구가 실패 → `apiError = true`"였고, 클라이언트는 `apiError`면 **데이터를
전부 숨기고 에러 화면만** 띄운다. DB 경로에서는 남은 MOLIT task가 "검증 안 된 월의 전월세"
하나뿐이라, 그 한 달이 16개 구 전부 실패하면 11개월치 DB 데이터를 갖고 있으면서도 전체
에러가 된다 — **실패를 0으로 접는 것의 거울상**이다. 그래서 DB 경로에서는 이 판정을 하지
않고(`!cached.dbBacked && …`), 그 상황을 정확한 표현인 `partial`(일부 지역 지연 배너)로
남긴다. DB 쿼리 자체가 실패하면 기존 최상위 catch가 요청을 에러로 만든다.

부분 실패 보고(`partial` / `failedDistricts`)는 그대로다. 호출하지도 않은 매매 task를
실패로 세지 않도록 `const aptFailed = !dbBacked && …`로 걸었다(dashboard와 동일 패턴).

### 7.4 캐시

키를 `stats-feed-sido:v2:…`로 올렸다(담는 값의 모양이 바뀌었으므로). **TTL은 5분 그대로**이고
캐시 지점 수도 그대로(단일 구 1 + 시도 전체 1)다. `getOrSetCache`의 in-flight 공유도 그대로라
같은 cold 키로 동시에 들어온 요청은 여전히 한 번만 실행된다.

---

## 8. §6 측정 결과

### 8.1 호출 수

| | before | after |
|---|---|---|
| MOLIT 호출(부산 전체 12개월) | **384** | **16** (= 16구 × 검증 안 된 전월세 1개월) |
| MOLIT 호출(부산 전체 7일) | 32 | 16 |
| DB 쿼리 | 1 (페이지 단지 context) | 4 (매매 1 + 전월세 1 + coverage 1 + context 1) + 워밍업 `SELECT 1` 2 |
| 법정동코드 프록시 | 1 | 1 |

### 8.2 응답 시간 (라우트 핸들러 직접 호출, `scripts/audit-stats-feed-12m-after.ts`)

로컬 개발 PC(홈 회선 → Supabase) 기준:

```
  3866ms  HTTP 200  sidoCode=26&period=12m   total=83216 verified=82602 canceled=614 apiError=false partial=false
   297ms  HTTP 200  sidoCode=26&period=12m   (warm, 같은 값)
  1006ms  HTTP 200  sidoCode=26&period=7d
    62ms  HTTP 200  sidoCode=26&period=7d    (warm)
  1061ms  HTTP 200  sidoCode=26&period=30d
  1797ms  HTTP 200  lawdCd=26140&period=7d   (단일 구 = 무변경 경로)
   137ms  HTTP 200  lawdCd=26140&period=7d   (warm)
```

Production 기준선(직전 STEP에서 반복 실측): 12m cold **22.39s / 25.46s**, warm 0.85~0.93s.

| 목표 | 결과(로컬) |
|---|---|
| warm ≤ 2s | **297ms — 달성** |
| cold ≤ 3s(권장) | 3.87s — 미달 |
| cold ≤ 5s(허용) | **3.87s — 달성** |
| 반복 10s 초과 = FAIL | **해당 없음(반복 실행에서도 4초 미만)** |

로컬 cold의 3.0초는 **row 전송 대역폭**이다(§3.3). 같은 규모의 매매 row 전송을 이미 하는
`/api/stats/dashboard?sidoCode=26`이 production에서 2.42s인 것을 보면 Vercel(icn1)에서는
이보다 빠를 가능성이 높지만, **production 실측은 배포 후 별도로 확인해야 한다** — 아래 §11.

---

## 9. 검증

```
npx tsx --test src/lib/stats/feed-db-source.test.ts     18/18 pass
npx tsx --test "src/**/*.test.ts"                      1045/1045 pass  (신규 18 포함, 회귀 0)
npx tsc --noEmit                                       src/ 오류 0
                                                       (tmp/*.ts 4건은 사전 존재 — 사용자 작업물,
                                                        예전 splitVerifiedMonths 시그니처 사용)
npx eslint <변경 파일 4개>                                오류 0 / 경고 0
npm run build                                          Compiled successfully
```

read-only 감사 스크립트 6개(`scripts/audit-stats-feed-12m-*.ts`)를 함께 커밋했다 — 위 모든
숫자가 재현 가능하다. DB write 0회, MOLIT GET만, schema 변경 0건.

---

## 10. 알려진 문제 / 건드리지 않은 것

1. **전월세 지연 등록 누락(약 0.1%)** — §6.4 원인 1. 완료월을 다시 확인하는 rent recheck
   sweep이 없기 때문이다. 고치려면 **새 cron**이 필요하다 → STOP 목록, 승인 사항. 이 STEP은
   보고만 한다. (참고: `sale`에는 이미 `sale-recheck`가 있고 3.2일에 한 바퀴 돈다.)
2. **매매 취소 플래그 래칫** — `APARTMENT_TRADE_SYNC_COVERAGE_AUDIT_V1` §7.2의 기존 결함.
   고치려면 production backfill이 필요하다 → STOP 목록. 이 STEP은 건드리지 않았다.
3. **단일 구 조회는 여전히 MOLIT** — `lawdCd=26140&period=7d`는 13개월 lookback × 2 = 26
   호출(실측 1.37~1.8s). 목표 범위 안이라 이번 STEP에서 바꾸지 않았다(§39 "API 실패 vs 거래
   없음" 프로브 의미가 DB 경로에서 달라지므로 별도 STEP이 맞다).
4. **부산 밖 시도 전체 조회는 무변경** — 서울 등은 DB에 데이터가 없어 기존 MOLIT 경로를
   그대로 쓴다. 현재 sitemap/런칭 범위가 부산뿐이라 실사용 경로도 아니다.
5. **Supabase egress** — 12m cold 한 번에 약 87,000행(추정 11MB)을 옮긴다. TTL 5분·인스턴스당
   1회로 제한되지만 12개월 조회가 많아지면 무시할 양은 아니다. 전월세에도 좁은 select 전용
   fetcher를 두면 약 20% 줄일 수 있지만, 지금은 **검증범위 강제를 한 곳에 두는 신뢰 이득**을
   택해 기존 함수를 재사용했다.

---

## 11. 다음 STEP 후보 (제안만)

1. **production 실측 확인** — 배포 후 `sidoCode=26&period=12m` cold/warm을 2회 이상 측정해
   목표(≤3s 권장 / ≤5s 허용) 달성 여부를 기록한다. 로컬 3.87s는 대역폭 영향이 섞여 있다.
2. **rent recheck sweep 도입**(cron 추가 — 승인 필요). §10-1의 0.1% 누락을 구조적으로 없애고,
   피드·dashboard·조건검색의 전월세 건수를 원천과 일치시킨다.
3. **취소 래칫 치유**(production backfill — 승인 필요). occurrence 그룹 단위로 원천과 대조해
   과다 취소를 되돌린다.
4. **단일 구 피드 DB-first 전환** — §39 프로브의 의미를 DB 경로에 맞게 재정의한 뒤 진행.
5. **`annotateTrades`의 SQL 이관 검토** — 12개월 창의 row 전송 자체를 없애는 유일한 길이지만
   신고가/직전거래 정의를 SQL로 옮기는 작업이라 신뢰 영향이 크다. 지금은 필요 없다(집계
   연산은 0.5초 미만).
