# TRADE DB FIRST V1 — STEP B: 84㎡ 국민평형 순위 + 거래량 DB-FIRST 전환

## 1. 목적

STEP A가 만든 공통 read core(`queryTrades()`)를 실제 사용자 경로에
처음으로 연결한다. 대상은 사용자 스펙이 지정한 두 기능:

- **84㎡ 국민평형 순위**(`/stats/area84`, `mode=area84`)
- **거래량**(`/stats/volume`의 "표" 뷰, `/api/stats/yearly`)

절대 원칙(재확인): 사용자 요청 → 이집 API → TradeHistory DB →
aggregation → 응답. 이 STEP이 전환하는 경로에서 MOLIT 실시간 호출을
하지 않는다. DB에 없으면 정직하게 NO DATA — 다른 데이터로 대체하지
않는다.

## 2. 범위 결정: Busan-scoped 라우팅 (fallback 아님)

TradeHistory DB는 설계상 부산 16개 구·군만 커버한다(전국이 아님).
`/stats`는 `RegionSelectModal`을 통해 전국 지역 선택이 실제로 가능한
화면이므로, "DB에 없으면 MOLIT" 같은 fallback을 만들지 않고 **요청의
지역이 부산인지 아닌지로 영구적으로 다른 경로를 타도록** 설계했다:

```
isBusanScopedRequest(lawdCd) === true  → TradeHistory DB (신규)
isBusanScopedRequest(lawdCd) === false → 기존 MOLIT 실시간 경로 (완전 동일, 무변경)
```

이것은 "DB가 비어서 어쩔 수 없이 우회한다"가 아니라 "DB가 원천적으로
커버하지 않는 지역은 애초에 이 분기를 타지 않는다"는 고정 라우팅이다
— 사용자 스펙의 "DB에 없으면 MOLIT 호출 금지" 원칙과 충돌하지 않는다
(DB가 있는데 비어서 우회하는 게 아니라, DB 커버리지 밖이라 처음부터
분기하지 않음).

## 3. 84㎡ 국민평형 순위 — FULL 전환

### 3-1. 대상 파일

`src/app/api/stats/price-rankings/route.ts` (`mode=area84`)

### 3-2. 구현

기존 `buildArea84RankingRows`/`buildHistory`/`filterVerifiedTrades` 등
순수 함수(`src/lib/price-ranking.ts`)는 **한 글자도 바꾸지 않았다**.
바뀐 것은 오직 이 함수들에 넣어주는 `allTrades: FeedTrade[]`의
출처뿐이다:

```ts
async function fetchArea84TradesFromDb(lawdCds: string[]): Promise<FeedTrade[]> {
  const from = new Date();
  from.setMonth(from.getMonth() - HISTORICAL_LOOKBACK_MONTHS);
  const { trades } = await queryTrades({
    lawdCd: lawdCds,
    from,
    exclusiveAreaRange: { gte: 84, lt: 85 },
  });
  return trades.map(storedTradeToFeedTrade);
}
```

부산 스코프(`sidoCode=26` 전체 또는 개별 `lawdCd`가 `26`으로 시작)일
때만 이 함수를 타고, 그 외 지역은 기존 MOLIT 실시간 fetch 블록을
완전히 그대로 사용한다. dedup/dong 필터/`areaFilter`/
`buildArea84RankingRows(allTrades, period)`/정렬/페이지네이션/평형·
context 배치 조회/응답 JSON까지 이후 전체 로직은 무변경 — 오직
`allTrades`의 소스 함수만 부산 요청일 때 교체된다.

**84~85㎡ 밴드로 미리 필터링해도 안전한 이유**: `buildHistory`의
`groupKey`가 항상 exact area를 포함하므로, 밴드 밖 거래가 밴드 안
후보의 history/직전거래/2년 최고가 비교에 참조될 수 있는 경로가
구조적으로 없다(리뷰로 확인, 실측으로도 재확인).

### 3-3. QA (Production, live)

6개 구·군(26110/26230/26260/26290/26410/26470) + 부산 전체
(`sidoCode=26`) + 소규모 구(기장군 26710) 전부 실제 DB 데이터로 정상
반환 확인:

- 각 구마다 서로 다른 실제 단지명/거래가/직전거래 대비/2년 최고가 대비
  수치 반환(다른 단지 fallback 없음 확인)
- 기간 필터(1개월/3개월/6개월/12개월/24개월) 전부 정상
- 정렬(가격높은순 등) 전부 정상

### 3-4. Benchmark (Production)

| 시나리오 | cold | warm |
|---|---|---|
| 단일 구(warm) | - | 516~573ms |
| 부산 전체(sido-all, warm, 캐시 우회 위해 다른 period 사용) | 9.46s* | 2,235ms |

*부산 전체 cold 9.46초는 내가 작성한 코드가 아니라 기존(무변경)
`getSigunguListForSido()`의 외부 regcode-proxy 네트워크 호출이
원인(모듈 레벨 `Map`에 최초 1회만 캐시됨) — 캐시가 이미 데워진
상태에서 재측정하니 2,235ms로, STEP A가 동일 쿼리 형태로 이미 측정한
2,189~2,371ms와 사실상 일치. 회귀 아님, 기존 의존성.

**상태: FULL PASS.**

## 4. 거래량 — PARTIAL 전환 (설계 근거 포함)

### 4-1. 조사: `/stats/volume`이 실제로 부르는 API

`type-client.tsx`에서 `slug==='volume'`은 `<VolumeChartCard>` 하나만
렌더링한다. `VolumeChartCard.tsx`를 전체 읽은 결과, 이 컴포넌트는
**두 개의 서로 다른 API**를 부른다:

- `/api/stats/dashboard` — 그래프 뷰(차트) + `volumeSummaryByPeriod`
  (건수/증감률 요약 배지)
- `/api/stats/yearly` — "표" 토글 뷰(연도별 최고가/최저가/평균가/건수)

### 4-2. `/api/stats/dashboard`를 이번 STEP에서 전환하지 않은 이유

380줄 단일 route를 전체 읽고 내린 판단:

- `hotIssues`/`gapInvest`/`topPrices`/`jeonseRate`/
  `currentMonthTrades`/`complexTrades`/`volumeRanking`/
  `volumeByPeriod`/`chartDataByType`/`volumeSummaryByPeriod`/`summary`가
  **하나의 공유 `getOrSetCache`** 안에서, MOLIT에서 받은 매매+전월세
  데이터를 함께 계산한다 — `/stats/volume` 전용 로직이 아니라 다른
  화면들도 같이 쓰는 공유 캐시/계산 블록이다.
- `chartDataByType`/`volumeSummaryByPeriod`는 매매뿐 아니라 전세·월세
  차트도 포함하는데, TradeHistory DB는 `dealType='sale'`만 존재한다
  (`TRADE_HISTORY_DATA_V1` V1 범위, rent 데이터 자체가 DB에 없음) —
  이 부분은 애초에 DB로 전환할 대상이 없다.
- 매매 부분만 부분적으로 떼어내려면 이 공유 캐시/계산 블록을 안전하게
  분리하는 리스크 있는 리팩터링이 필요한데, 이는 스펙 §41이 명시적으로
  금지한 "지역변동지도/캐시/preaggregation 등 이번 STEP 범위 밖" 작업과
  경계가 겹친다.

**판단**: 이번 STEP 예산 안에서 안전하게 끝내기 위해, `dashboard.ts`는
건드리지 않고 그대로 두었다. 이는 "몰라서 놓친" 게 아니라 "조사 후
의도적으로 범위를 좁힌" 결정이며, 후속 STEP 후보로 아래 §7에 남긴다.

### 4-3. `/api/stats/yearly` — 실제 전환한 부분

`fetchYearlySaleTableFromDb()`가 부산 요청의 매매(sale) 연도별 표만
DB-first로 전환한다. 전세/월세는 4-2와 동일한 이유(DB에 데이터 자체가
없음)로 기존 MOLIT 경로 그대로 유지 — "DB에 없어서 우회"가 아니라
"이 dealType은 애초에 DB 대상이 아닌 고정 라우팅"(§2와 동일 원칙).

### 4-4. 성능 문제 발견 및 수정 (raw fetch → DB aggregate)

최초 구현은 `queryTrades({lawdCd, from})`(limit 없음)로 원시 행을
가져와 Node에서 reduce하는 방식이었다. 해운대구(26350, 13년,
69,025행)로 실측한 결과 **단독 12.9초**, 전체 route(전월세 MOLIT
fetch와 병렬)는 **60초 타임아웃**으로 실패 — STEP A 문서(§6)가 이미
경고한 "지역 전체×장기간×무필터 raw fetch" 패턴을 그대로 재현한
것이었다.

**수정**: `trade-history-read.ts`에 신규 `getYearlySaleAggregate()`
추가, `$queryRaw` + `GROUP BY EXTRACT(YEAR FROM deal_date)`로 연도별
count/max/min/avg를 Postgres 안에서 직접 계산:

```ts
export async function getYearlySaleAggregate(lawdCd: string, fromYear: number): Promise<YearlyAggregateRow[]> {
  return prisma.$queryRaw`
    SELECT EXTRACT(YEAR FROM deal_date)::int AS year, COUNT(*)::int AS count,
           MAX(deal_amount)::int AS max_amount, MIN(deal_amount)::int AS min_amount,
           ROUND(AVG(deal_amount))::int AS avg_amount
    FROM apartment_trade_histories
    WHERE lawd_cd = ${lawdCd} AND deal_type = 'sale' AND deal_canceled = false
      AND deal_date >= ${fromDate}
    GROUP BY EXTRACT(YEAR FROM deal_date) ORDER BY year ASC
  `;
}
```

수정 후 해운대구 동일 요청: **450ms**(60초 타임아웃 → 정상 응답).

### 4-5. 정합성 검증

- 해운대구: 신규 aggregate의 연도별 `count` 합계가 raw-row 총 건수
  69,025와 정확히 일치.
- 서구(26140): 전/후 값이 연도별로 byte-identical.
- 취소 제외 정확성: 서구 기준 취소 포함 10,337건 vs 취소 제외
  10,287건(취소 50건) — 실제 엔드포인트 응답이 정확히 10,287로 일치.

### 4-6. UI 회귀 확인 (Production 브라우저, live)

`/stats/volume?...lawdCd=26140`에서 "표" 토글 클릭 → 매매 탭: 2026년
634건/2025년 747건/2024년 854건/2023년 642건 등 실제 데이터 정상
렌더링. 전세 탭 클릭 → 기존 MOLIT 경로 그대로 정상 동작(무변경 확인).
375px/360px/390px 전부 오버플로우/텍스트 잘림/하단 네비 겹침 없음.

**상태: PARTIAL PASS** — `/api/stats/yearly`의 매매 표는 완전 전환·
검증 완료. `/api/stats/dashboard`의 그래프/요약 배지는 미전환(§4-2
근거, 후속 STEP 후보).

## 5. Test / Build

- `npx tsc --noEmit`: 20건(기존 baseline과 정확히 동일 — `scripts/`
  내 무관 파일들, 변경한 3개 파일에는 오류 0).
- `npx eslint` (변경 3개 파일): clean.
- `npx tsx --test`(전체): **691/691 PASS**(STEP A 종료 시점과 동일 —
  회귀 없음).
- `npm run build`: PASS("Compiled successfully").

## 6. Known Limitations

- `/api/stats/dashboard`(그래프 뷰 + 건수 요약 배지)는 미전환 —
  §4-2에서 조사 후 의도적으로 범위를 좁힌 것이며, "몰라서 놓침"이
  아니다.
- 전세/월세 거래량은 어떤 경로로도 DB 전환 대상이 아니다(TradeHistory
  DB `dealType='sale'`만 존재, `TRADE_HISTORY_DATA_V1` V1 범위의
  고정된 한계).
- 취소(cancellation) completeness는 STEP A와 동일하게 최근 13개월만
  검증됨(전체 기간 미검증) — read core 자체의 한계.

## 7. 후속 STEP 후보 (이번 STEP 범위 아님, 기록만)

- `/api/stats/dashboard`의 매매 관련 계산(예: `volumeSummaryByPeriod`
  sale 부분, `chartDataByType.sale`)을 공유 캐시 블록에서 안전하게
  분리해 DB-first로 전환. 전세/월세는 DB에 데이터가 없으므로 대상
  아님.
- STEP A 문서 §9가 이미 남긴 최근 상승/최근 하락/지역 변동지도
  DB-first 전환(스펙 §41이 이번 STEP에서 명시적으로 제외).
