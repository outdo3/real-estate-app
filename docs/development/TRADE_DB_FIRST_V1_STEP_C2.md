# TRADE DB FIRST V1 — STEP C-2: 최근 상승·하락 부산 전체 성능 최적화

## 1. 목적

STEP C는 최근 상승/하락을 부산 요청에 한해 DB-first로 전환했지만
(PASS), 부산 전체 cold 요청이 약 7.3초로 측정돼 PM 판정은 "기능
PASS / 성능 PARTIAL"이었다. 이번 STEP은 기능 정의(하락=priorHigh
비교, 상승=immediatePrior 비교, aptSeq+exact area+dealType identity,
취소 제외, 24개월 lookback)를 전혀 바꾸지 않고 부산 전체 cold 성능만
개선한다.

## 2. 기존 병목 재확인

STEP C의 구현은 "부산 전체 24개월×전체면적 65,532 row를 통째로
Node로 가져와 JS `buildHistory()`가 계산"하는 방식이었다(area84와
달리 면적 band 필터가 없어 후보를 줄일 수 없음). 배치 병렬 쿼리로
9.3~10.1초 → 4.0~7.3초까지는 줄였지만(STEP C), 여전히 목표(heavy
<3초)를 넘었다.

## 3. 설계 방향: SQL pushdown 우선, index 변경은 최후

스펙의 명시적 지시대로 "index가 필요하다"고 먼저 결론 내리지 않고,
65K row를 Node로 옮기는 구조 자체를 없앨 수 있는지부터 검증했다 —
최종적으로 index/schema 변경 없이 순수 SQL(window function + JOIN)만
으로 목표를 달성했다.

### 3-1. 1차 시도(실패로 기록) — Candidate-filter 방식

먼저 "어느 group_key가 후보인지"만 SQL window function으로 판정해
후보 group의 24개월 전체 이력만 다시 가져와 기존
`buildDeclineRows()`/`buildRisingRows()`에 그대로 넣는 방식을 시도했다.
correctness는 100% 보장되지만(최종 계산이 여전히 검증된 JS 함수),
실측 결과 기간이 길어질수록 후보 group 수가 전체 group 수에 근접해
(12개월 하락 기준 후보 4,007개 group, 재조회 시 51,729 row — 원본
65,532 row와 큰 차이 없음) **오히려 STEP C보다 느려졌다**(최악
11.2초, FAIL 위험). 이 방식은 폐기했다.

### 3-2. 최종 채택 — 단일 SQL pass로 최종 row 직접 계산

`priorHigh`(하락)/`immediatePrior`(상승)의 금액과 날짜를 **row
재조회 없이** window function만으로 계산해, 최종 후보 row(부산 전체
기준 881~4,012건)만 애플리케이션으로 반환한다.

- **group_key 신뢰성**: 스키마에 이미 저장된 `group_key` 컬럼
  (regional-feed.ts의 `groupKey()`를 backfill/sync 시점에 그대로 호출한
  결과)을 PARTITION BY로 직접 사용 — JS `groupKey()`를 재구현하지
  않는다. 855,047개 부산 row 전체를 Node에서 재계산해 대조한 결과
  **불일치 0건**으로 신뢰성을 실측 확인했다.
- **priorHigh 금액**: `MAX(deal_amount) OVER (PARTITION BY group_key
  ORDER BY deal_date ASC, id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND
  1 PRECEDING)` — strictly 이전 시점까지의 running max.
- **priorHigh 날짜**(표준 MAX()가 주지 않는 값): "이 row가 실제로
  running max를 갱신시켰는가"(`is_new_high`)를 먼저 계산하고, 그 상태를
  앞으로 전파하는 3단계 window로 얻는다 — 상관 서브쿼리(argmax lookup)
  없이 순수 window function만으로 해결.
- **immediatePrior**(상승): `LAG(deal_amount)`/`LAG(deal_date)`로 직접
  계산 — decline과 달리 argmax 문제 자체가 없다.
- **"기간 내 최근 거래" 선정**: `ROW_NUMBER() OVER (PARTITION BY
  group_key ORDER BY deal_date DESC, id DESC)` 를 기간 필터링 후
  계산해 `rn=1`만 후보로 채택.

### 3-3. same-day tie-break 재현(§9 요구사항)

STEP C가 이미 문서화한 "동일 날짜 다건 거래 tie-break 미정의"(STEP C
§5-2)를 이번에 **몰래 새 규칙으로 바꾸지 않았다**. 대신 STEP C의 실제
프로덕션 동작(`orderBy:[{dealDate:'desc'},{id:'desc'}]` 기반 DB fetch
→ JS stable sort가 보존하는 순서)을 SQL에서 그대로 재현했다: 모든
window ORDER BY를 `deal_date ASC, id DESC`(priorHigh/immediatePrior
계산)와 `deal_date DESC, id DESC`("최근 거래" 선정)로 맞춰, 동일
날짜 동점에서 id가 더 큰 거래를 먼저(시간상 앞선 것처럼) 취급하는
STEP C의 기존 동작을 그대로 따른다.

## 4. Correctness 확보 과정 — 3개의 실측 버그를 raw SQL 대조로 발견·수정

Old(STEP C 현재 DB-first 구현, oracle)과 New(SQL pushdown)를 6개
지역(부산 전체/해운대구/서구/동래구/부산진구/기장군)×5개 기간(7d/30d/
3m/6m/12m)×2모드(하락/상승) = **60케이스** 전부 비교했다. 매번 같은
dev 서버에서 코드를 stash/복원해 "직전 코드"와 "새 코드"를 최대한
가까운 시점에 실측(temporal drift 배제)했다.

### 4-1. 버그 1 — 24개월 경계일 누락(BOUNDARY-FIX)

`$queryRaw`로 보내는 JS `Date`는 Prisma의 타입세이프 필터(예:
`queryTrades()`의 `dealDate: {gte: input.from}`)와 달리 `@db.Date`
컬럼 타입에 맞춰 자동 정규화되지 않는다. `new Date()`의 시/분/초를
그대로 유지한 채 24개월만 뺀 값을 파라미터로 보내면, Postgres가 이를
자정 이후 시각으로 취급해 정확히 경계일(24개월 전 그 날짜) 거래가
`>=` 비교에서 조용히 제외됐다 — 동래구 12개월 하락 A/B에서 2건 누락,
둘 다 정확히 경계일 `priorHighDate`를 가진 케이스였다. STEP B의
`getYearlySaleAggregate()`가 이미 쓰던 안전 패턴(`Date.UTC(year,0,1)`,
시각 없이 자정 고정)과 동일하게 UTC 자정으로 명시 생성해 고정.

### 4-2. 버그 2 — 자연키 중복 미제거(DEDUPE)

기존 route.ts는 `buildDeclineRows`/`buildRisingRows` 호출 전 항상
`allTrades = dedupeTrades(allTrades)`(groupKey+dealAmount+dealDate+
floor가 같으면 하나만 남김)를 거친다 — MOLIT 월별 fetch의 달 경계
중복 대응으로 만들어진 기존 안전장치인데, **DB에도 동일 자연키를 가진
row가 실제로 2건 이상 존재하는 사례**가 있었다(예: 26140-978/
84.9891㎡, 2025-08-19 동일 금액·동일 층 row 2개 — 856K row 백필
과정의 중복으로 추정). SQL이 이 dedup을 거치지 않아 과다 카운트됐다 —
`ROW_NUMBER() OVER (PARTITION BY group_key, deal_amount, deal_date,
floor ORDER BY id DESC) = 1`로 dedupeTrades와 동일한 자연키 기준
dedup·동일 승자 선택을 재현했다.

### 4-3. 버그 3 — RANGE 방식 trailing12moSampleCount의 이중 부정확

`trailing12moSampleCount`(§15 표본 규칙, `hasSufficientSample` 판정에
쓰임)는 JS `monthsBetween(a,b)=(by-ay)*12+(bm-am)<=12` — **일(day)은
완전히 무시하고 연·월만 비교**하는 값이다.

- **1차 오류**: `RANGE BETWEEN INTERVAL '12 months' PRECEDING`(일 단위
  정밀 뺄셈)을 썼더니 day-of-month 차이로 매 케이스 수십 건씩 어긋남.
  → `(연*12+월)`을 정수 "month_index"로 미리 계산해 RANGE 경계를 정수
  오프셋(`12 PRECEDING`)으로 바꿔 day를 완전히 무시하도록 수정.
- **2차 오류**: month_index 수정 후에도 소수 케이스가 여전히 어긋남.
  원인: `RANGE ... CURRENT ROW`는 "같은 month_index를 가진 모든 row"를
  무조건 peer로 묶어 포함시키는데, JS의 `sampleCount`는 자기 자신보다
  **더 이른 row만** 센다 — 같은 달 안에 여러 거래가 있고 "최근 거래"로
  뽑힌 row가 그 달의 첫 번째(id가 더 큼)라면, 같은 달의 "나중" row는
  RANGE peer로는 포함되지만 JS 기준으로는 포함되면 안 된다(26260-1476
  /84.965㎡, 2026-08-18 동일가 2건 사례로 확인). → base에 `row_seq`
  (그룹별 `deal_date ASC, id DESC` 순번)를 추가하고, 후보와 base를
  `row_seq <= 후보.row_seq AND month_index >= 후보.month_index - 12`
  조건으로 **JOIN**해 GROUP BY로 COUNT.

**성능 함정 기록**: 이 JOIN 조건을 먼저 상관 서브쿼리(후보 row마다
`(SELECT COUNT(*) FROM base WHERE ...)`를 한 번씩 실행)로 구현했더니
부산 전체 12개월 기준(하락 4,012건/상승 2,645건 후보) **43.4초/28.9초**
가 걸렸다 — `group_key`가 인덱스 없는 컬럼이라 후보 하나당 base 전체에
가까운 scan이 반복된 것. 완전히 동일한 논리 조건을 상관 서브쿼리 대신
**JOIN + GROUP BY**로 바꾸자(옵티마이저가 nested-loop 대신 hash join을
선택) **1.17초/0.62초**로 떨어졌다 — 동일 논리라도 상관 서브쿼리 대
JOIN의 실행계획 차이가 이렇게 클 수 있다는 실측 교훈.

### 4-4. 최종 A/B 결과

위 3개 수정 전부 적용 후 60케이스 재실측(tight A/B, 매번 stash/
restart로 시점 일치): 모든 필드(currentAmount/currentDate/
priorHighAmount/priorHighDate/previousAmount/previousDate/declinePct/
risePct/trailing12moSampleCount)가 완전히 일치했다. 유일하게 남은
차이는 8/60 파일에서 페이지(limit=100) 경계에 걸린 row 1개씩 — 확인
결과 risePct/declinePct가 정확히 동점인 두 후보 중 어느 쪽이 100번째
자리에 들어가는지가 tie-break 순서에 따라 갈리는 것으로, STEP C가
이미 문서화한 "동일 날짜/동점 tie-break 미정의"와 동일한 근본 원인
이며 데이터 오류가 아니다 — 두 후보 모두 각자 기준으로는 정확히
계산된 값이었다(예: 부산 전체 rising 6m, `26350-2166|111.07`↔
`26350-158|126.93`, 둘 다 risePct=7.5로 완전 동점, total은 old=230=
new=230로 동일).

## 5. Row 전송량 개선

| | BEFORE(STEP C) | AFTER(STEP C-2) |
|---|---|---|
| DB→Node 전송 row(부산 전체 12개월 하락) | 65,532(전체 원본) | 4,012(최종 후보 row만) |

기존 방식은 원본 전체를 옮겨 JS가 계산했지만, 새 방식은 최종 답만
전송한다 — 약 94% 감소.

## 6. Query 수

부산 전체 기준 **1개 쿼리**(단일 `$queryRaw` 문, WITH 절 내부에서
CTE+JOIN으로 전부 처리) — STEP C의 16개(8개씩 2배치)에서 더 줄었다.
N+1 없음. Connection pool 부담도 STEP C보다 감소.

## 7. Index

기존 인덱스(`[lawdCd, dealDate]`)가 base CTE의 초기 필터링에
그대로 사용됨을 `EXPLAIN (ANALYZE, BUFFERS)`로 확인했다(Index Scan,
Execution Time 233ms for 30d 시나리오). `group_key`/`row_seq`/
`month_index`는 CTE 내부 계산값이라 인덱스가 필요 없다 — 이번 STEP은
**schema/index 변경 없이** 목표를 달성했다. `INDEX_CHANGE_RECOMMENDED`
보고 대상 아님.

## 8. 최종 성능 실측

| 시나리오 | STEP C(기존) | STEP C-2(이번) |
|---|---|---|
| decline, 서구(단일 구) cold | ~1.7s | 1.97s(최초 컴파일 포함)/warm 0.30s |
| decline, 부산 전체 12m cold | 7.3s | **1.35s** |
| decline, 부산 전체 12m warm | 2.4s | 0.27s |
| rising, 부산 전체 12m cold | 2.45s | **1.11s** |
| rising, 서구(단일 구) cold | 0.3s | 0.44s |

목표(heavy<3초, 5초 초과 시 최적화 검토, 10초 FAIL) 대비: **3초 목표
달성**(모든 시나리오 <2초). STEP C가 남긴 "3초 목표 미달성" 문제를
완전히 해결했다.

## 9. MOLIT / 부산 user path

`fetchMonthGated()`에 임시 로그로 재검증: 미검증 부산 구(fresh cache)
decline+rising 요청 → **0건** apt MOLIT 호출. 미검증 비부산 구 →
**24건**(24개월) — probe 자체 정상 동작 확인. record-high/jeonse-risk
는 이번에도 건드리지 않음(범위 밖 유지). 검증 후 임시 로그는 즉시
원복(`git diff` 무변경 확인).

## 10. Regression

Production 브라우저로 `/stats/decline`(동래구), `/stats/rising`
(서구), `/stats/area84`(서구), 홈 전부 STEP C/B 캡처와 byte-identical
확인. UI 코드(`PriceRankingView.tsx` 등)는 이번 STEP에서 전혀 수정
하지 않았다 — API 응답 계약도 완전히 동일(필드/타입 무변경). 모바일
360/375/390은 `resize_window` 도구가 이 세션에서 여전히 비활성 상태
(기존부터 알려진 한계)라 직접 재검증하지 못했지만, UI 컴포넌트가
100% 무변경이라 STEP B/C가 이미 통과시킨 모바일 QA가 그대로 유효하다.

## 11. Test / Build

- `npx tsc --noEmit`: 20건(기존 baseline과 동일, 변경 파일 오류 0).
- `npx eslint`(변경 3개 파일): clean.
- `npx tsx --test`(전체): **691/691 PASS**.
- `npm run build`: PASS.
- 신규 unit test는 추가하지 않음 — `price-ranking.ts`의 46개 기존
  테스트가 이미 계산 정의(priorHigh/immediatePrior/취소 제외/exact
  area 등)를 커버하고, 이번 STEP이 실제로 검증해야 하는 것은 "새 SQL이
  그 정의와 동일한 결과를 내는가"이므로 60케이스 tight A/B가 그
  증거다(§4).

## 12. Database

Production READ만. INSERT/UPDATE/DELETE/schema/migration = 0.

## 13. Known Limitations

- 페이지 경계 tie-break(§4-4)는 STEP C부터 존재하던 근본 원인(동일
  날짜/동점 순서 미정의)이 여전히 남아있다 — 이번 STEP은 이를 만들지도
  악화시키지도 않았고, 고치려면 제품 정의(명시적 tie-break 규칙)를
  새로 결정해야 하므로 범위 밖으로 남긴다.
- record-high(신고가)는 여전히 MOLIT 의존 — 다음 STEP 후보.
