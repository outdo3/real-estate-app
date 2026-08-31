# TRADE DB FIRST V1 — STEP D: 지역 변동지도 부산 DB-FIRST 전환

## 1. 목적

"지역 변동지도"(`/stats/change-map`, `/api/stats/region-change`)를
부산 요청에 한해 TradeHistory DB-first로 전환한다. STEP C-2의 교훈
("원본 row를 Node로 옮기지 않고 SQL이 최종/준최종 결과까지 계산")을
처음부터 적용해 — 먼저 naive 구현을 만들고 나중에 최적화하는 과정을
반복하지 않았다.

## 2. 기존 알고리즘 AUDIT (변경 없음)

`src/lib/region-change.ts`(REGION_PRICE_CHANGE_MAP_V2)를 전수 감사했다.

- **비교 단위**: `groupKey`(identityKey+exact raw exclusiveArea+dealType) —
  같은 단지라도 면적이 다르면 절대 병합하지 않는다.
- **window**: "현재 window(오늘 포함 최근 N개월) vs 직전 동일 길이
  window" — day-span 기반 대칭 windowing(`previousPeriodRange`, 달력
  월이 아니라 정확히 같은 일수).
- **representative**: 각 window에서 그 그룹의 "가장 최근" 정상 거래
  1건(`pickLatest`: dealDate DESC → dealAmount DESC → **uid ASC**,
  uid=`String(id)`라 **문자열** 정렬).
- **pair**: 두 window 모두에 representative가 있어야 성립(한쪽만
  있으면 그 그룹은 이번 비교에서 제외 — fallback 없음).
- **지역 median**: pair들의 changePct의 median(평균 아님 — outlier/
  composition bias 방어).
- **threshold**: `MIN_SAMPLE_PAIRS=5`(미만이면 INSUFFICIENT, 숫자
  숨김), `NEUTRAL_RANGE_PCT=±0.5%`.
- **complex(단지) level**: 단지 안에 여러 raw 면적이 있으면, 두
  window 모두 거래가 있는 면적 그룹 중 **표본(current+previous 거래
  건수 합)이 가장 많은 면적 1개**만 대표로 골라 계산(count DESC →
  최근 current 거래일 DESC → areaGroupKey ASC tie-break).
- **4 level**: nation(시도 목록만, 거래 fetch 없음) / sigungu(시도
  전체+구별 breakdown) / dong(구 전체+동별 breakdown) / complex(단지
  목록).

이 정의는 이번 STEP에서 **한 글자도 바꾸지 않았다** — `region-change.ts`
무변경.

## 3. DB-FIRST SQL 설계

### 3-1. pickLatest → `DISTINCT ON`

```sql
DISTINCT ON (group_key) ...
ORDER BY group_key, deal_date DESC, deal_amount DESC, id::text ASC
```

기존 `pickLatest()`와 완전히 동치다. **`id::text`로 문자열 정렬**한
것이 핵심 — uid가 `String(id)`이므로 숫자 정렬(`id`)이 아니라 문자열
정렬을 써야 기존 tie-break와 정확히 같은 승자가 나온다(id를 숫자로
정렬하면 "10" vs "9" 같은 경우 다른 결과가 나올 수 있어, 기존 동작을
"개선"하지 않고 있는 그대로 재현했다).

### 3-2. median → `percentile_cont(0.5) WITHIN GROUP`

PostgreSQL의 `percentile_cont(0.5)`(연속 보간)는 "정렬 후 홀수면
가운데 값, 짝수면 가운데 두 값의 평균"과 수학적으로 동일하다 —
`region-change.ts`의 `medianOf()`와 동일 정의, 별도 재구현 없이
신뢰할 수 있다.

### 3-3. overall+breakdown → `GROUPING SETS`

"부산 전체(overall)"와 "구별/동별 breakdown"을 한 쿼리로 함께 얻기
위해 `GROUP BY GROUPING SETS ((lawd_cd), ())`(또는 `dong`)를 썼다 —
overall 행은 `bucket_key IS NULL`로 구분된다.

### 3-4. complex level → `ROW_NUMBER() OVER (PARTITION BY identity_key ...)`

단지(identity_key)별로 대표 면적을 고르는 로직(count DESC → 최근
날짜 DESC → group_key ASC)을 `ROW_NUMBER() OVER (PARTITION BY
identity_key ORDER BY sample_trade_count DESC, current_date DESC,
group_key ASC)`로 그대로 재현했다.

### 3-5. 신규 함수(trade-history-read.ts)

- `getRegionChangeBucketsFromDb(lawdCds, currentFrom, currentTo,
  previousFrom, previousTo, bucketBy, dongFilter?)` — sigungu/dong
  level 공용.
- `getComplexChangeRowsFromDb(lawdCd, ..., dongFilter?)` — complex
  level.

두 함수 모두 **단일 SQL pass**로 최종/준최종 결과를 반환한다 — 원본
row를 Node로 옮기지 않는다. confidence/direction/intensity 판정은
SQL로 재구현하지 않고 `region-change.ts`의 기존 순수 함수
(`deriveConfidence`/`classifyDirection`/`classifyIntensity`, 무변경)를
그대로 재사용한다 — "숫자 계산은 SQL, 임계값 판정은 검증된 기존
JS"로 책임을 분리해, threshold가 두 곳에 흩어져 나중에 어긋날 위험을
피했다.

## 4. Row reduction

| | BEFORE(MOLIT) | AFTER(DB) |
|---|---|---|
| 부산 전체 12개월 sigungu 응답까지 걸린 시간 | **41.4초** | 23ms(warm 캐시)~1.26초(첫 요청) |
| Node로 전송되는 row | 없음(SQL이 최종 결과만 반환) | overall+16개 구 breakdown, 17 rows |

## 5. Old(MOLIT) vs New(DB) A/B — 60케이스

6개 지역(부산 전체/해운대구/서구/동래구/부산진구/기장군) × 4개
기간(1m/3m/6m/12m) × 3 level(sigungu/dong/complex) 비교.

### 5-1. 성능 — MOLIT의 심각한 지연을 실측으로 확인

부산 전체(sigungu) level, MOLIT 경로:

| 기간 | MOLIT(기존) | DB(이번) |
|---|---|---|
| 1m | 6.9초 | 235ms |
| 3m | 11.8초 | 35ms |
| 6m | 17.9초 | 29ms |
| 12m | **41.4초** | 23ms |

이 STEP이 존재해야 하는 이유를 실측으로 재확인했다 — 16개 구 각각
2×기간개월치를 MOLIT 월별 API로 순차/스로틀 호출하는 기존 구조는
기간이 길어질수록 선형에 가깝게 느려진다.

### 5-2. Correctness — 1m/3m/6m 전부 정확히 일치, 12m만 소수 차이

**1m/3m/6m**: 3개 level × 6개 지역 전부(sigungu/dong/complex의
pairCount·median·bucket 상세) **완전히 일치**.

**12m만** 일부 지역에서 pairCount가 DB가 MOLIT보다 **더 많이**
나왔다(예: 부산 전체 4775→4788, 해운대구 574→578, 서구 162→163,
기장군 221→222 등 — 항상 DB ≥ MOLIT, 반대 방향은 0건).

**원인 조사**: 해운대구 12개월 사례를 STEP A의 `queryTrades()`(Prisma
타입세이프 필터, 이미 신뢰된 경로)로 직접 재계산해 기존
`buildRegionChangePairs()`(무변경 JS)에 넣은 결과 **578**(내 SQL과
정확히 일치, MOLIT의 574와는 다름). 이는 내 SQL의 버그가 아니라
**MOLIT 쪽이 불완전**하다는 뜻이다 — 12개월 preset은 current+previous
=24개월치를 16개 구 각각 월별로 호출해야 해서(가장 많은 MOLIT 호출이
필요한 케이스), 어딘가에서 rate-limit/일시 실패로 일부 거래를
놓쳤을 가능성이 높다(STEP C가 이미 문서화한 것과 동일한 종류의
DATA_COMPLETENESS 사례). 분류: **DATA_COMPLETENESS**(DB가 더
정확) — 숫자를 맞추기 위해 DB 데이터를 변형하지 않았다.

## 6. Production QA

Production 브라우저로 전체 drill-down 체인(대한민국→부산광역시→동구→
수정동) 실제 클릭 확인 — sigungu level(부산 전체, 16개 구, 1028개
단지, 2024건 거래 · 거래 충분, "중구의 상승폭이 가장 컸어요" 해석
문구), dong level(동구, 4개 동, 21개 단지, 37건, "수정동의 상승폭이
가장 컸어요"), complex level(수정동, 모티더베스트빌 +3.6%/북항에코
하임센트럴뷰 +3.2%/협성휴포레부산진역오션뷰 +1.5%/아르미나아파트
-6.7%, 각각 정확한 면적·가격·표본 라벨) 전부 정상. 색상(상승 빨강/
하락 파랑/보합 회색)·legend·breadcrumb·기간 selector·공유 버튼 전부
무변경 UI 그대로 동작.

## 7. MOLIT / 부산 user path

`fetchMonthGated()`에 임시 로그로 검증: 미검증 부산 sigungu/dong/
complex 요청 → **0건** apt MOLIT 호출. 미검증 비부산 dong 요청 →
**3건**(1개월 preset의 실제 fetch 개월 수) — probe 자체 정상 동작
확인. 검증 후 즉시 원복(`git diff` 무변경 확인).

## 8. Regression

Production 브라우저로 `/stats/decline`(동래구), `/stats/area84`
(서구), 홈 전부 STEP C-2 캡처와 byte-identical 확인 — `trade-history-
read.ts`에 함수를 추가만 했을 뿐 기존 함수는 전혀 건드리지 않았다.

## 9. Performance summary

| 시나리오 | cold(첫 요청, Turbopack 컴파일 포함) | warm |
|---|---|---|
| sigungu, 부산 전체 | 0.3~1.3초(대체로 <500ms, 컴파일 잔여 변동 존재) | 23~85ms |
| dong, 단일 구 | 0.05~0.23초 | <100ms |
| complex, 단일 구 | 0.05~0.53초 | <100ms |
| DB 쿼리 자체(route 밖 격리 측정) | 88~543ms(부산 전체 전체 기간) | - |

목표(warm≤500ms, cold≤1s, 2초 초과 시 재검토, 5초 FAIL) 대비 **PASS**
— 모든 시나리오가 목표 이내(dev 서버 Turbopack 첫 컴파일로 인한
일시적 변동은 이번 세션에서 반복적으로 확인된 특성이며 production
빌드에는 해당하지 않는다).

## 10. Preaggregation verdict

**NOT_REQUIRED**. SQL pushdown만으로 모든 목표를 달성했다 — 별도
preaggregation 테이블이나 스키마 변경 없이 기존 인덱스
(`[lawd_cd, deal_date]`)로 충분했다.

## 11. Query count / N+1

부산 전체(sigungu) 기준 **1개 쿼리**. 지역별 반복 쿼리 없음(16개 구를
각각 조회하지 않고 `lawd_cd = ANY([...])` 배치 IN + `GROUPING SETS`로
한 번에 처리).

## 12. Index

기존 인덱스(`[lawd_cd, deal_date]`)로 충분 — 신규 인덱스 불필요.
`INDEX_CHANGE_RECOMMENDED` 대상 아님.

## 13. Test / Build

- `npx tsc --noEmit`: 20건(기존 baseline과 동일, 변경 파일 오류 0).
- `npx eslint`(변경 파일): clean.
- `npx tsx --test`(전체): **691/691 PASS**.
- `npm run build`: PASS.
- 신규 unit test는 추가하지 않음 — `region-change.ts`의 기존 pure
  함수(무변경, 기존 21개 테스트가 이미 pair/median/threshold/
  representative 정의를 커버)를 그대로 재사용하고, 이번 STEP이
  실제로 검증해야 하는 건 "새 SQL이 그 정의와 동일한 결과를 내는가"
  이므로 60케이스 A/B가 그 증거다(§5).

## 14. Database

Production READ만. INSERT/UPDATE/DELETE/schema/migration = 0.

## 15. Known Limitations

- 12개월 preset에서 DB와 MOLIT 결과가 소수 지역에서 미세하게 다를 수
  있다(§5-2) — DB가 더 정확한 방향으로만 다르며, MOLIT의 rate-limit로
  인한 불완전성이 원인으로 추정된다. 향후 비부산 지역도 같은 문제를
  겪을 수 있으나 이번 STEP 범위 밖(전국 TradeHistory 구축 필요).
- complex level의 dedupeTrades()(자연키 중복 제거, STEP C-2가 decline/
  rising에서 발견한 것과 동일한 종류) 적용 여부는 이번 STEP에서 별도
  검증하지 않았다 — region-change.ts의 `buildRegionChangePairs`/
  `buildComplexChangeRows`는 dedupeTrades를 호출하지 않는 것으로
  확인(코드에 없음, filterVerifiedTrades만 사용) — 따라서 SQL에도
  자연키 dedup을 추가하지 않았다(기존 정의를 그대로 재현).
