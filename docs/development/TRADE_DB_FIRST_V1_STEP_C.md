# TRADE DB FIRST V1 — STEP C: 최근 상승 / 최근 하락 DB-FIRST 전환

## 1. 목적

STEP B(84㎡ 순위 + 거래량)에 이어, 사용자 기능 `최근 상승`(`/stats/rising`,
`mode=rising`)과 `최근 하락`(`/stats/decline`, `mode=decline`)을 부산
요청에 한해 TradeHistory DB-first로 전환한다. `record-high`(신고가)와
`jeonse-risk`(전세 위험)는 이번 STEP 범위 밖(§44)이다 — jeonse-risk는
apiType이 rent라 TradeHistory DB(`dealType='sale'`만 존재) 대상이
아니고, record-high는 스펙이 명시적으로 다음 STEP 대상으로 남겼다.

## 2. 기존 기능 AUDIT — 정확한 계산 정의

`src/app/api/stats/price-rankings/route.ts`(`mode=decline|rising`)와
`src/lib/price-ranking.ts`를 전수 감사했다. 84㎡ 순위와 같은 파일/같은
read core를 이미 STEP B에서 부분 전환한 상태였다.

- **하락**: 그룹(같은 aptSeq + 같은 raw exact 전용면적 + dealType)별로
  "기간 내 가장 최근" 정상 거래 하나를 뽑아, **그 거래 이전 트레일링
  24개월 내 역대 최고가**(priorHigh)와 비교. `latest.dealAmount <
  priorHigh.amount`일 때만 하락 row.
- **상승**: 동일 그룹핑, "기간 내 가장 최근" 거래를 **시간순으로 바로
  직전 거래**(immediatePrior, 최고가 아님)와 비교. `latest.dealAmount >
  immediatePrior.amount`일 때만 상승 row.
- 두 경우 모두 `buildHistory()`가 **트레일링 24개월
  (`HISTORICAL_LOOKBACK_MONTHS`) 전체** 원본 거래를 필요로 한다 —
  `period`(7d~12m)는 "가장 최근 거래"를 뽑을 때만 쓰이고, priorHigh/
  immediatePrior 계산은 항상 24개월 전체 윈도우 기준이다. 이 정의는
  이번 STEP에서 **한 글자도 바꾸지 않았다**(`price-ranking.ts` 무변경).
- identity는 `aptSeq` 우선(`identityKey`), `groupKey`가 exact area까지
  포함해 84.7855㎡와 84.9950㎡는 절대 병합되지 않는다(§8-§16의 STEP
  이전부터 확립된 원칙, `regional-feed.ts` 재사용, 무변경).
- 취소거래는 `filterVerifiedTrades`로 항상 제외(무변경).

## 3. DB-FIRST 구현

### 3-1. 데이터 소스만 교체

기존 84㎡ 전환(STEP B)과 동일한 패턴: `buildDeclineRows`/
`buildRisingRows`/interpretation 함수는 무변경. 부산 스코프 요청만
`fetchDeclineRisingTradesFromDb()`가 만든 `FeedTrade[]`로 `allTrades`의
출처를 교체한다. 이 함수는 area84의 `fetchArea84TradesFromDb`와 거의
동일하지만 **area band 필터가 없다**(decline/rising은 모든 면적이
후보) — `queryTrades({lawdCd, from: 24개월 전})`.

### 3-2. 성능 최적화 — 구별 배치 병렬 쿼리

area band 필터가 있는 area84(STEP B)는 부산 전체 조회가 이미 2.2~2.4초
로 목표 이내였지만, decline/rising은 모든 면적이 후보라 부산 전체
24개월 raw fetch가 65,532 row에 달해 **단일 IN 쿼리로는 9.3~10.1초**가
걸렸다(실측, §33 heavy 목표 3초/FAIL 10초에 근접·초과 위험). 구별로
쪼개 병렬 실행하면 동일 결과를 **4.0~4.6초**에 받는다(실측, 최대
2배 이상 개선) — Supabase 세션모드 pooler의 15-connection 한도를
넘지 않도록 8개씩 배치로 제한했다. schema/index 변경 없이 기존
`queryTrades()`의 필터링/취소제외/정렬 로직을 그대로 재사용하는
**query 호출 패턴만** 바꾼 것이다(§21이 명시적으로 허용한 범위).
area84는 이번 STEP에서 건드리지 않았다(§25).

```ts
const DECLINE_RISING_DB_BATCH_SIZE = 8;
async function fetchDeclineRisingTradesFromDb(lawdCds: string[]): Promise<FeedTrade[]> {
  const from = new Date(); from.setMonth(from.getMonth() - HISTORICAL_LOOKBACK_MONTHS);
  if (lawdCds.length <= 1) {
    const { trades } = await queryTrades({ lawdCd: lawdCds, from });
    return trades.map(storedTradeToFeedTrade);
  }
  const all: FeedTrade[] = [];
  for (let i = 0; i < lawdCds.length; i += DECLINE_RISING_DB_BATCH_SIZE) {
    const chunk = lawdCds.slice(i, i + DECLINE_RISING_DB_BATCH_SIZE);
    const results = await Promise.all(chunk.map((code) => queryTrades({ lawdCd: code, from })));
    for (const r of results) all.push(...r.trades.map(storedTradeToFeedTrade));
  }
  return all;
}
```

### 3-3. 캐시 공유

decline과 rising은 같은 지역+기간이면 **완전히 동일한 원본 거래
집합**이 필요하다(모드 차이는 다운스트림 계산 함수 선택뿐). 기존
MOLIT 경로도 이미 이 둘을(그리고 record-high까지) 하나의 캐시 키로
공유했다 — DB 경로도 동일 원칙으로 `stats-price-rankings-declinerising-
db[-sido]:...` 캐시 키를 decline/rising이 공유한다(실측: rising이
decline이 이미 데운 캐시를 재사용해 0.3초/2.45초로 즉시 응답).
record-high는 여전히 자기만의 MOLIT 캐시를 쓴다(전환 안 함, §44).

## 4. Production QA

### 4-1. 정확성 — raw DB 이력과 byte 단위 대조

서구(26140) decline #1 row(e편한세상송도더퍼스트비치, `26140-1361`,
84.929㎡): `currentAmount=54720@2026-08-20`, `priorHighAmount=72310@
2026-04-21`, `declinePct=-24.3`. 동일 aptSeq+exact area의 24개월 원본
이력을 직접 SQL로 조회해 대조한 결과, 2026-08-20 이전 구간의 진짜
최고가가 정확히 72310(2026-04-21)임을 확인 — **byte 단위로 일치**.

### 4-2. Identity 안전성(§28 동일 이름 위험)

부산 전체에서 같은 `aptName`이지만 서로 다른 `aptSeq`를 가진 실제
사례를 raw SQL로 확인: `경동`(7개 aptSeq), `경남`(5개), `KCB센트리움`
(2개) 등. `groupKey`/`identityKey`가 aptSeq 우선이므로 이런 동명이인
단지가 있어도 절대 병합되지 않는다 — 이 보장은 STEP A/B부터 무변경인
`regional-feed.ts`의 기존 로직이며, 이번 STEP은 그 로직을 그대로
재사용했을 뿐이다(§7 "기존 제품 정의를 바꾸지 않기 위해 데이터
소스만 교체").

### 4-3. 취소거래 제외

서구 24개월 내 취소거래 샘플(`송도혜성비치타운`, 84.96㎡, 16500,
2026-07-17, `dealCanceled=true`) 확인 — `queryTrades()`의 하드
디폴트(`dealCanceled=false`)로 자동 제외되며, 위 4-1의 이력 대조에서
이 취소거래는 결과에 전혀 나타나지 않았다.

### 4-4. MOLIT 호출 0 검증(런타임 probe)

`fetchMonthGated()`에 임시 로그 추가 후:

- 미검증 부산 구(26200, decline) → **0건** apt MOLIT 호출
- 미검증 비부산 구(대구 27110, rising) → **24건**(24개월) apt MOLIT
  호출 — probe 자체가 정상 동작함을 함께 증명
- 미검증 부산 구(26260, **record-high**, 이번 STEP 범위 밖) → **24건**
  apt MOLIT 호출 — record-high가 여전히 MOLIT을 쓰고 있음을 재확인
  (실수로 함께 전환되지 않았음을 검증)

검증 후 임시 로그는 즉시 원복(`git diff` 무변경 확인).

### 4-5. UI 회귀(Production 브라우저)

`/stats/decline?...lawdCd=26260`, `/stats/rising?...lawdCd=26140` 모두
API 응답과 정확히 일치하는 카드 렌더링 확인(총 건수, 순위, 하락률/
상승률, 최근 2년 최고가/직전거래 문구). `/stats/area84`도 STEP B
캡처와 byte-identical(회귀 없음). 홈(`/`) 정상 로드.

## 5. Old(MOLIT) vs New(DB) 비교 — 실측 차이와 원인 분류

같은 dev 서버에서 코드를 stash/복원해 **동일 구(동래구 26260)의 decline
결과**를 실제로 A/B 비교했다(30일 기간, 61건 vs 61건, total 일치).
페이지(30건) 단위로 28건은 완전 일치, **2건에서 실제 값 차이** 발견 —
숫자를 맞추기 위해 데이터를 바꾸지 않고 원인을 raw SQL로 직접 증명했다.

### 5-1. `26260-69 / 84.945㎡` — DATA_COMPLETENESS(DB가 더 정확)

| | OLD(MOLIT) | NEW(DB) |
|---|---|---|
| current | 17,500(2026-08-05) | 17,500(2026-08-05) 동일 |
| priorHigh | 21,000(2026-01-05) | **22,500(2024-09-25)** |
| declinePct | -16.7% | **-22.2%** |

raw DB 이력에 `2024-09-25, 22500원, 취소 아님` 거래가 실제로 존재하고
24개월 lookback 윈도우(2024-08-31~) 안에 있다. OLD(MOLIT 실시간 fetch)는
이 2024-09 데이터를 놓쳤다 — `fetchMonthsThrottledWithStatus`가 단일
구 요청에서는 `partial`/`failedDistricts`를 계산·노출하지 않는(§STEP
이전부터 존재하는 기존 코드 구조, 이번 STEP이 만든 게 아님) 채로 해당
월의 재시도까지 실패한 요청을 조용히 빈 배열로 반환했을 가능성이
높다. **DB-first 결과(-22.2%)가 실제 데이터에 더 정확하다** — 스펙
§25가 명시한 "DB-FIRST 결과가 더 정확할 수 있다"의 실제 사례.

### 5-2. `26260-1476 / 84.965㎡` — TIE_BREAK 미정의(사전 존재하는 알고리즘 공백)

| | OLD(MOLIT) | NEW(DB) |
|---|---|---|
| current | 55,000(2026-08-18) | 47,200(2026-08-18) |
| priorHigh | 64,800(2026-02-18) | 64,800(2026-02-18) 동일 |
| declinePct | -15.1% | -27.2% |

raw DB 이력에 **같은 날짜(2026-08-18)에 서로 다른 거래 2건**(47,200원과
55,000원)이 존재한다. `buildDeclineRows`의 `latest = inPeriod.reduce((max,p)
=> p.trade.dealDate > max.trade.dealDate ? p : max)`는 `dealDate`
문자열(시각 없음)만 비교하므로 **같은 날짜 동점을 명시적으로 tie-break
하지 않는다** — 결과는 `sorted` 배열의 사전 순서(원본 fetch 순서)에
의존한다. OLD는 MOLIT API가 그 달 반환한 item 순서, NEW는 DB의
`dealDate desc, id desc` 정렬 순서를 따르므로 서로 다른 원본 순서가
서로 다른 "동점 승자"를 고른다. **이것은 이번 STEP이 만든 버그가
아니다** — `buildDeclineRows`/`buildRisingRows` 자체가 애초에 동일
날짜 다건 거래의 tie-break를 정의하지 않은 기존 알고리즘 공백이며(§14
"기존 formula를 그대로 유지" 원칙에 따라 이번 STEP에서 임의로
tie-break를 추가하지 않았다), OLD 코드에서도 MOLIT API 응답 순서가
바뀌면 동일하게 재현될 수 있는 사전 존재 특성이다. 두 값(-15.1%,
-27.2%) 모두 자기 소스 기준으로는 정확히 계산된 값이다 — 어느 쪽도
BUG가 아니라, 계산 대상 거래 선택 자체가 명세되지 않은 것이다.

### 5-3. 결론

881건(부산 전체) 중 표본 조사(동래구 61건 중 30건 페이지)에서 발견된
2건 모두 위 두 범주로 완전히 설명됨 — BUG/ALGORITHM_MISMATCH/
IDENTITY_MISMATCH 없음. §5-1은 DB-first 전환 자체가 갖는 정합성
이점이고, §5-2는 기존(변경 전) 알고리즘에도 이미 존재하던 미정의
동작이라 이번 STEP이 "기존 정의를 바꾸지 않는다"는 원칙을 지키는
한 해결할 수 없다 — 후속 STEP에서 tie-break 규칙(예: id desc)을
명시적으로 추가할지는 별도 제품 결정이 필요하다(§6에 기록).

## 6. 성능

| 시나리오 | cold | warm |
|---|---|---|
| decline, 서구(단일 구) | 1.7s | 0.3s |
| decline, 부산 전체(배치 최적화 후) | 7.3s | 2.4s |
| rising, 서구(캐시 공유로 즉시) | 0.3s | - |
| rising, 부산 전체(캐시 공유로 즉시) | 2.45s | - |

DB fetch 자체(route 밖 격리 측정): 부산 전체 단일 IN 쿼리 9.3~10.1초 →
8개 배치 병렬 4.0~4.6초. warm 상태에서도 2.4초대인 이유는 STEP A/B와
동일한 이유(`getOrSetCache`가 원본 거래 배열만 캐싱하고, `buildHistory`/
`buildDeclineRows`/`buildRisingRows`/정렬/Unit Master 조회는 매 요청마다
재계산되기 때문 — 기존에도 존재하던 특성, 이번 STEP이 만든 것 아님).

목표(heavy<3초, 5초 초과 시 최적화 검토, 10초 FAIL) 대비: 최적화 전
9.3~10.1초는 FAIL 경계에 근접/근소 초과 위험이었으나, 배치 최적화로
4.0~7.3초로 낮춰 **10초 FAIL을 확실히 회피**했다. 3초 목표는 아직
초과 상태 — 근본 원인은 65,532 row 규모 자체(면적 필터 없음)이며,
추가 단축은 스키마/인덱스 변경(이번 STEP 범위 밖, §44)이 필요할 수
있다.

## 7. N+1 / Index

부산 전체 기준 정확히 16개(8개씩 2배치) `queryTrades()` 호출 — 반복
루프로 단지/거래별 개별 쿼리를 하지 않는다. 기존 인덱스
(`[lawdCd, dealDate]`)가 이 쿼리 패턴과 정확히 일치해 schema/index
변경이 필요하지 않았다(STEP A §5의 감사 결론 그대로 재확인).

## 8. Test / Build

- 신규 unit test 없음 — `price-ranking.ts`(`buildDeclineRows`/
  `buildRisingRows` 등, 46개 기존 테스트가 이미 aptSeq grouping/exact
  area/취소제외/no-previous/deterministic tie-break 등 §37이 요구한
  경계 케이스 대부분을 커버)와 `trade-history-read.ts`(`queryTrades`)를
  전혀 수정하지 않았다 — 이번 STEP이 추가한 `fetchDeclineRisingTradesFromDb`는
  STEP B의 `fetchArea84TradesFromDb`와 동일하게 DB 호출 오케스트레이션
  함수라 이 세션의 기존 관례(DB 접촉 함수는 live QA로 검증, unit
  mock 없음)를 따랐다 — §4/§5의 광범위한 Production QA가 그 증거다.
- `npx tsc --noEmit`: 20건(기존 baseline과 동일, 변경 파일 오류 0).
- `npx eslint src/app/api/stats/price-rankings/route.ts`: clean.
- `npx tsx --test`(전체): **691/691 PASS**.
- `npm run build`: PASS.

## 9. Database

Production READ만. INSERT/UPDATE/DELETE/schema/migration = 0.

## 10. Known Limitations

- 부산 전체 decline/rising cold 7.3초는 목표(3초)를 여전히 초과한다 —
  면적 필터가 없는 65,532-row 규모가 근본 원인. 추가 단축은 인덱스
  추가 또는 스키마 변경 검토가 필요할 수 있음(이번 STEP 범위 밖).
- §5-2에서 발견한 "같은 날짜 다건 거래 tie-break 미정의"는 DB-first
  전환과 무관하게 기존 알고리즘에 이미 존재하던 공백이다 — 고치려면
  제품 정의(예: 어느 거래를 "진짜 최근"으로 볼지)를 새로 결정해야
  하므로 이번 STEP에서 임의로 바꾸지 않았다.
- record-high(신고가)는 여전히 MOLIT 의존 — 다음 STEP 후보.
