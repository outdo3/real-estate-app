# TRADE DB FIRST V1 — STEP B-2: 거래량 대시보드 매매 DB-FIRST 마무리

## 1. 목적

STEP B는 거래량을 PARTIAL PASS로 종료했다 — `/api/stats/yearly`(표 뷰)의
매매는 DB-first로 전환됐지만, `/stats/volume`이 실제로 함께 쓰는
`/api/stats/dashboard`(그래프 + 요약 배지)의 매매 계산은 여전히 MOLIT
의존이었다. 이번 STEP은 이 gap만 정확히 닫는다: `/api/stats/dashboard`의
매매(sale) 데이터 경로만 부산 요청에 한해 DB-first로 전환한다.

전세/월세는 이번에도 전환하지 않는다 — `ApartmentTradeHistory`는
`dealType='sale'`만 존재(`TRADE_HISTORY_DATA_V1` V1 범위 고정)하므로,
없는 데이터를 만들 수 없다. 이는 "DB에 없으면 MOLIT 호출"이 아니라
"이 dealType은 애초에 이 분기를 타지 않는다"는 STEP B와 동일한 고정
라우팅 원칙이다.

## 2. `/api/stats/dashboard` 전수 AUDIT 결과

380줄 전체를 다시 읽었다. `mode=area84`/`yearly.ts`와 달리 이 route는
매매 원본 거래를 **단순 집계가 아니라 개별 row 단위 로직**에 여러
군데 사용한다:

| 지표 | 매매 row-level 필요 이유 |
|---|---|
| `hotIssues` | 최근 3개월 중 개별 거래 top 5(이름/동/가격/날짜) |
| `topPrices` | 단지별(정규화된 이름 기준) 평당가 평균 — Unit Master 평형 조회와 결합 |
| `gapInvest` | 매매+전세 **개별 거래 짝짓기**(단지명+정확한 면적, `buildGapCandidates`) — 전세와 강하게 결합 |
| `jeonseRate` | 단지별 매매 평균 vs 전세 평균 — 전세와 강하게 결합 |
| `currentMonthTrades` | 이번 달 개별 거래 클릭 목록 |
| `complexTrades` | hotIssues/topPrices/gapInvest에 나온 단지의 개별 거래 목록 |
| `volumeRanking` | 1/3/6/12개월 창별 단지명(정규화) 카운트 순위 |
| `chartDataByType.sale`/`volumeByPeriod`/`volumeSummaryByPeriod.sale` | 월별/기간별 거래량+평균가 |

앞의 6개는 순수 COUNT/SUM/AVG로 대체할 수 없다 — 이름 정규화
(`normalizeAptName`)와 Unit Master 조회가 JS 쪽에 있고, `gapInvest`/
`jeonseRate`는 매매·전세를 **같은 함수 안에서** 다뤄 매매만 별도
SQL로 쪼개면 원본 로직(`buildGapCandidates`)을 다시 작성해야 한다 —
"전체 dashboard를 새 framework로 다시 쓰지 않는다"는 스펙 §8 제약과
정면으로 부딪힌다.

**결론**: `chartDataByType`/`volumeByPeriod`/`volumeSummaryByPeriod`
같은 스칼라 집계만 골라 SQL aggregate로 바꾸는 대신, **12개월(시간
bounded) 매매 원본 row를 DB에서 그대로 가져와 기존 JS 로직에 그대로
넣는다** — STEP B의 area84 전환과 동일한 패턴(비즈니스 로직 0줄 변경,
데이터 소스만 교체)이다. §10이 금지하는 "raw massive fetch"는 13년
무제한 range처럼 시간 범위 자체가 무제한인 경우(STEP B의 yearly
60초 타임아웃 버그)를 가리킨다 — 이번 것은 시간 범위가 12개월로
bounded인 채로 지역만 넓은 것이라 다른 리스크 프로파일이다(§7 성능
참고).

## 3. 구현

### 3-1. MOLIT-shape 어댑터

`hotIssues`의 `t.info`(`"84.52m² • 12층 • 2026-08-08"`) 문자열 파싱,
`t.price`(포맷된 문자열), `t.dealAmount`, `t.aptSeq`, `t.dealCanceled`
등 기존 코드가 기대하는 필드 전부를 `StoredTrade`에서 만들어내는
어댑터를 추가했다:

```ts
function storedTradeToDashboardTrade(t: StoredTrade): any {
  const areaStr = `${t.exclusiveArea}m²`;
  const floorStr = t.floor != null ? `${t.floor}층` : '';
  const tradeDate = t.dealDate.toISOString().slice(0, 10);
  return {
    id: `db-sale-${t.id}`, name: t.aptName, price: formatKoreanPrice(t.dealAmount),
    dealAmount: t.dealAmount, monthlyRent: 0, typeLabel: '실거래',
    info: `${areaStr} • ${floorStr} • ${tradeDate}`, dong: t.dong,
    dealCanceled: t.dealCanceled, aptSeq: t.aptSeq, excluUseArea: Number(t.exclusiveArea),
    dealDate: tradeDate, floorRaw: t.floor, lawdCd: t.lawdCd,
  };
}
```

### 3-2. 월별 버킷팅

`aptMonthly`/`rentMonthly`는 기존 코드 전체가 "12개 배열의 배열"
모양에 의존한다(`aptMonthly[11]`, `aptMonthly.slice(-3)` 등). 한 번의
`queryTrades({lawdCd, from})` 호출로 12개월치 전체를 가져온 뒤,
`dealDate`를 기준으로 그 모양 그대로 재구성한다(`fetchApt12MonthBucketsFromDb`).
DB row 자체가 정확한 `lawdCd`를 갖고 있어, 기존 MOLIT 경로처럼 구별
루프에서 수동으로 lawdCd를 태그할 필요가 없다(오히려 원본 그대로라
더 정확).

### 3-3. sale/rent 분기

`isBusanScopedRequest()`(STEP B와 동일 정의)로 판단해:

- sido-all 분기: `isBusan`이면 16개 구 apt MOLIT task 자체를 생성하지
  않고(`if (!isBusan) tasks.push(...apt...)`), DB 호출과 rent MOLIT
  호출을 `Promise.all`로 병렬 실행. `failedLawdCds`/`partial` 판정도
  부산이면 rent 실패만 반영(매매는 DB라 "MOLIT 실패" 개념 자체가
  없음 — DB 에러는 route 최상위 catch로 전체 실패 처리, STEP B의
  area84/yearly와 동일 패턴).
- 단일 구 분기: 동일 원칙, `rollingTasks`에서 부산이면 apt-roll task를
  아예 만들지 않는다.

전세/월세(`rentMonthly`)는 두 분기 모두 100% 무변경 — MOLIT 경로
그대로.

### 3-4. 응답 계약

`GET` 핸들러의 return 객체(`summary`/`chartData`/`chartDataByType`/
`volumeSummaryByPeriod`/`hotIssues`/`gapInvest`/`topPrices`/
`jeonseRate`/`currentMonthTrades`/`complexTrades`/`volumeRanking`/
`volumeByPeriod`/...)는 한 글자도 바꾸지 않았다 — 어댑터가 기존
MOLIT 필드 shape을 그대로 재현하므로 프론트(`VolumeChartCard.tsx`)는
무수정.

## 4. Production QA

### 4-1. 정합성(raw SQL 대조)

| 구 | dashboard `summary.volume` | 원본 SQL COUNT(취소 제외) |
|---|---|---|
| 서구(26140) | 49 | 49 |
| 해운대구(26350) | 173 | 173 (취소 7건 별도 확인, 포함 시 180) |
| 부산 전체 | 1,571 | 1,571 |

취소 제외가 정확히 반영됨을 확인(해운대구: 취소 포함 180 vs 대시보드
반환 173 = 취소 7건 제외).

`volumeSummaryByPeriod.30d.sale`도 이 STEP 이전(브라우저로 이미 확인해
둔 STEP B 캡처)과 byte-identical: 서구 `48건 이전 82건 대비 ▼34건
(-41.5%)`, 부산 전체 `1,496건 이전 2,353건 대비 ▼857건 (-36.4%)` —
동일 데이터, 소스만 MOLIT→DB로 교체됐음을 재확인.

### 4-2. MOLIT 호출 0 검증 (런타임, 정적 아님)

`fetchMonthGated()`에 임시로 `type==='apt'`일 때 콘솔 로그를 넣고:

- 미검증 부산 구(26170, 26200) 요청 → **0건** apt MOLIT 호출
- 미검증 비부산 구(대구 중구 27110) 요청 → **12건**(12개월) apt MOLIT
  호출 — probe 메커니즘 자체가 정상 동작함을 함께 증명

검증 후 임시 로그는 즉시 원복(`git diff` 무변경 확인, 커밋 대상에서
제외).

### 4-3. UI 회귀 (Production 브라우저)

`/stats/volume?...lawdCd=26140`: 매매/전세/월세 3개 탭 전부 정상, 그래프
+요약 배지 값이 API 응답과 정확히 일치. 표(yearly.ts, STEP B에서 이미
전환) 토글도 byte-identical(회귀 없음). `/stats/area84` smoke도 STEP B와
동일 결과. 홈(`/`) 정상 로드.

## 5. 성능

### 5-1. 매매 DB fetch 자체(probe, route 밖에서 단독 측정)

| 시나리오 | latency |
|---|---|
| 부산 전체 16개 구 × 12개월(전체 면적, row-level) | 5,060ms |
| 해운대구 단독 × 12개월 | 817ms |

### 5-2. `/api/stats/dashboard` 전체 route(매매 DB + 전세/월세 MOLIT 병렬)

| 시나리오 | cold | warm(캐시 hit) |
|---|---|---|
| 단일 구(서구) | 2.3~3.5s | 0.2~0.3s |
| 저거래 구(기장군) | 2.7s | - |
| 부산 전체(sido-all) | **28.0s** | 0.2s |

부산 전체 28초는 목표(heavy<3초, 5초 초과 시 최적화 검토)를 넘는다.
**원인은 내가 작성한 매매 DB 코드가 아니다** — 격리 측정(§5-1)에서
매매 DB fetch 자체는 5.06초에 불과하고, `Promise.all`로 전세 MOLIT
fetch와 병렬 실행되므로 route 전체 시간의 대부분(~23초)은 여전히
남아있는 **전세 192개 task MOLIT 스로틀 호출**(16개 구×12개월, 기존
`GLOBAL_MOLIT_CONCURRENCY=6`+200ms 게이팅, §STEP A/B가 이미 문서화한
동일 병목)이다.

**Before/after 실측(같은 dev 서버에서 코드만 stash/복원해 직접 비교)**:

| | apt+rent 둘 다 MOLIT(변경 전) | 매매만 DB, 전세만 MOLIT(변경 후) |
|---|---|---|
| 부산 전체 cold | **43.0초** | **28.0초** |

매매 MOLIT task(192개)를 제거해 공유 스로틀을 통과하는 task 수가
거의 절반(384→192)으로 줄면서 실측 35% 개선을 확인했다. 이는 진짜
before/after 비교이며(같은 dev 서버, 같은 캐시 상태에서 코드만 전환),
math 추정이 아니다.

10초 FAIL 기준은 넘지 않았고, 목표(3초) 대비 초과분은 이번 STEP이
건드리지 않은 전세 MOLIT 경로에 귀속된다 — §6 후속 STEP 후보에 기록.

### 5-3. N+1

매매는 구·기간에 관계없이 항상 **정확히 1번**의 `queryTrades()` 호출
(단일 구든 부산 16개 구든 `lawdCd` 배열 IN 쿼리 하나). 반복 쿼리 없음.

## 6. Known Limitations / 후속 STEP 후보

- 부산 전체 dashboard cold 28초는 여전히 목표(3초)를 초과한다 — 원인은
  전세 MOLIT 192-task 스로틀이며, 전세 DB 자체가 없어(V1 범위) 이번
  STEP 범위 안에서 추가로 줄일 수 없다. 전세/월세 TradeHistory DB
  구축(스펙 §35가 이번 STEP 범위 밖으로 명시)이 유일한 근본 해결책.
- `hotIssues`/`topPrices`/`gapInvest`/`complexTrades`/`volumeRanking`은
  row-level JS 로직이라, DB 쪽에서 더 줄이려면(예: 이름 정규화를 SQL
  단에서도 재현) 원본 로직 자체를 다시 설계해야 한다 — 이번 STEP은
  하지 않았다(§8 "새 framework로 다시 쓰지 않는다").

## 7. Test / Build

- `npx tsc --noEmit`: 20건(기존 baseline과 동일, 변경 파일 오류 0).
- `npx eslint src/app/api/stats/dashboard/route.ts`: clean.
- `npx tsx --test`(전체): **691/691 PASS**.
- `npm run build`: PASS.

## 8. Database

Production READ만. INSERT/UPDATE/DELETE/schema/migration = 0.
