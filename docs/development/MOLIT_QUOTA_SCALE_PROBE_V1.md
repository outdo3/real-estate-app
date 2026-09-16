# E-JIP MOLIT QUOTA & SCALE PROBE V1

서울/경기 확장 전 MOLIT(국토교통부 실거래) API의 paging·호출량·quota 정량화. **READ-ONLY.**

- 날짜: 2026-09-16 (KST)
- 기준 커밋: `63e8397` (SEOUL_GYEONGGI_EXPANSION_DATA_AUDIT_V1 직후)
- 방법
  - API probe: `scripts/audit-molit-quota-scale-probe.ts` — 순차(동시 1) + 최소 간격 400ms + **재시도 없음**. totalCount만 필요한 호출은 `numOfRows=1`. 총 43 request / 약 17초. DB 접근 0.
  - DB: `scripts/audit-molit-quota-log-read.ts` — `SET TRANSACTION READ ONLY` + `statement_timeout 120s`, 서버측 집계만. write 0.
  - 코드: MOLIT client/sync 경로 정적 분석(파일:라인 근거).
- 하지 않은 것: burst load test, 429 유도, quota 소진 실험, DB write, migration, schema, bulk sync, region enable, sitemap enable, cron 변경, 코드 수정.
- serviceKey는 요청 URL을 포함해 어떤 출력·로그·이 문서에도 남기지 않았다.

---

## 0. 결론 요약

**판정: PAGING_FIX_REQUIRED**

1. **quota는 걱정거리가 아니었다.** 응답 헤더 `x-ratelimit-limit: 10000`이 실제로 내려오고, 카운터는 **endpoint(오퍼레이션)별로 독립**이다(매매 9882→9841, 전월세 9967→9928이 같은 실행에서 따로 감소). 부산+서울+경기 **5년 백필 전체가 endpoint당 하루치 한도 안에 들어간다**(매매 4,980 = 49.8%, 전월세 7,110 = 71.1%). 이전 audit이 최대 변수로 지목했던 "MOLIT 일일 한도"는 **확장의 제약이 아니다**.
2. **대신 진짜 결함은 paging이다.** `src/lib/api-molit.ts:126`의 라이브 경로는 `numOfRows=1000`만 붙이고 **`pageNo`가 없으며 `totalCount`를 읽지 않는다**. 서울 전월세는 이 상한을 실제로 넘는다 — 강남구 2026-03 **2,091건**, 송파구 **1,873건**, 강남구 2026-08 **1,050건** 등 probe한 전월세 20셀 중 **6셀(30%)이 1,000 초과**. 지금 그 지역을 열면 화면·통계·점수가 조용히 절단된 데이터를 "전부"로 제시한다.
3. **부산에서 이 결함이 안 보였던 이유는 규모가 작아서다.** 부산 probe 최대 전월세 714건, 매매 387건. 서울 전월세 평균은 부산의 **4.2배**(1,339 vs 317). 즉 이건 확장하면 새로 생기는 위험이 아니라, **확장하는 순간 처음으로 드러나는 기존 결함**이다.
4. **대량 sync 경로는 이미 올바르다.** `scripts/sale-molit-fetch.ts`·`scripts/rent-trade-history/rent-molit-fetch.ts`는 `pageNo`/`totalCount`를 검증하며 전 페이지를 읽고, 부족하면 `PARTIAL`로 남긴다. Production에서 실제로 동작한 증거도 있다(전월세 1,000행 초과 셀 2개, 최대 1,047행 적재). **고칠 대상은 라이브 경로 하나뿐이다.**
5. **두 번째 병목은 quota가 아니라 cron 실행시간이다.** sale/rent sync는 고정 순서 루프 + 50초 예산이고 Vercel `maxDuration=60`이다. 부산 16구(64셀)는 지금 들어가지만 **83개 구(332셀)는 한 번의 cron에 절대 들어가지 않는다.** `districtOffset` 파라미터는 있으나 `vercel.json`이 넘기지 않고 **offset을 저장할 곳도 없다**(SyncRun 테이블 없음) — 회전이 작동하지 않는다.
6. **rate limit은 실재하나 관리 가능하다.** 최근 30일 error_logs 112건 중 **91건이 초당 요청제한**(최근 2026-09-11), timeout 6건. 초당 제한이지 일일 한도가 아니며, 이미 게이트(동시 4·250ms·차단기)가 있다. 백필은 동시 1·350ms 순차 스크립트로 돌리면 된다(부산에서 검증된 방식).

---

## 1. MOLIT client 감사

MOLIT을 호출하는 경로는 크게 셋이다.

| # | 경로 | 파일 | pageNo | totalCount 검증 | numOfRows | timeout | 재시도 | 동시성 |
|---|---|---|---|---|---|---|---|---|
| 1 | **라이브(사용자 요청)** | `src/lib/api-molit.ts:126` | **없음** | **없음** | 1000 | 5s | rate-guard 4회/8s 예산 | 게이트 동시 4 · 250ms |
| 2 | 대량 sync — 매매 | `scripts/sale-molit-fetch.ts:34` | 있음 | 있음 | 1000 | 10s | 페이지당 5회 + 백오프 | 동시 1 · 350ms |
| 3 | 대량 sync — 전월세 | `scripts/rent-trade-history/rent-molit-fetch.ts` | 있음 | 있음 | 1000 | 10s | 페이지당 5회 + 백오프 | 동시 1 · 350ms |

### endpoint

| type | endpoint | 용도 |
|---|---|---|
| `apt` | `RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev` | 아파트 매매 상세(등기·해제 필드 포함) |
| `rent` | `RTMSDataSvcAptRent/getRTMSDataSvcAptRent` | 아파트 전월세 |
| `silv` | `RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade` | 분양권 전매 |
| `officetel` | `RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade` | 오피스텔 매매 |
| `villa` | `RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade` | 연립다세대 |

공통 쿼리 파라미터: `serviceKey`, `LAWD_CD`(5자리 시군구), `DEAL_YMD`(YYYYMM), `numOfRows`, (경로 2·3만) `pageNo`.

### 라이브 경로(#1)의 소비자 — 절단의 영향 범위

`fetchMolitData()`를 호출하는 곳(테스트 제외):

```
/api/apt/[name]              /api/transactions          /api/admin/dashboard
/api/stats/feed              /api/stats/concentration   /api/stats/gap-invest
/api/stats/price-rankings    /api/school/[id]           /api/school/apartments
src/lib/regional-feed.ts     src/lib/trade-history-read.ts   src/lib/rent-history-read.ts
src/lib/school-trade-price.ts   src/lib/molit-stats-helpers.ts   src/lib/molit-month-cache.ts
src/lib/apartment-score/collectors/market.ts   src/services/publicDataService.ts
```

단지 상세·통계·학군·지역 피드·**점수 market collector**까지 전부 이 경로를 쓴다.

### 캐시·부가 동작

- 라이브 경로는 `next: { revalidate: 3600 }` — 1시간 캐시. 절단된 응답도 1시간 캐시된다.
- `src/lib/molit-month-cache.ts` 인메모리 캐시(이전 audit §22에서 무제한으로 지적).
- 실패 시 throw하지 않고 `typeLabel:'에러'` 플레이스홀더 1건을 반환하는 계약. `src/lib/apt-trade-completeness.ts`가 이를 `FAILED`로 분류해 부분 실패를 사용자에게 알린다 — **다만 이 판정식은 절단을 감지하지 못한다**(1,000건 정상 응답은 `SUCCESS_WITH_DATA`).

---

## 2. no-paging 결함 — 확정

**결함 존재: 확정(CONFIRMED).** 수정은 이번 STEP에서 하지 않았다.

`src/lib/api-molit.ts:126`
```
`${endpoint}?serviceKey=…&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000`
```
`pageNo` 없음 → 서버 기본값 1페이지. `totalCount`를 읽지 않으므로 **더 있는지조차 모른다.**

### 실측 재현 (2026-09-16 probe)

| 지역 | 월 | 데이터셋 | totalCount | 라이브 경로가 보는 건수 | 누락 |
|---|---|---|---|---|---|
| 서울 강남구 11680 | 202603 | 전월세 | **2,091** | 1,000 | **1,091 (52.2%)** |
| 서울 송파구 11710 | 202603 | 전월세 | **1,873** | 1,000 | **873 (46.6%)** |
| 경기 성남시 분당구 41135 | 202603 | 전월세 | **1,358** | 1,000 | **358 (26.4%)** |
| 서울 마포구 11440 | 202603 | 전월세 | **1,150** | 1,000 | **150 (13.0%)** |
| 서울 송파구 11710 | 202608 | 전월세 | **1,128** | 1,000 | **128 (11.3%)** |
| 경기 김포시 41570 | 202603 | 전월세 | **1,061** | 1,000 | **61 (5.7%)** |
| 서울 강남구 11680 | 202608 | 전월세 | **1,050** | 1,000 | **50 (4.8%)** |

매매는 probe한 20셀 전부 1,000 미만(최대 경기 수원시 영통구 202603 = 577)이라 **현재 월 기준으로는 매매 절단이 발생하지 않는다.** 다만 Production DB에 1,000행을 넘는 매매 셀이 23개(최대 2,442행) 존재한다 — 과거 호황기 월에는 매매도 넘는다.

### Production DB 증거

| 항목 | 값 | 해석 |
|---|---|---|
| 매매 셀 중 **정확히 1,000행** | **0개** | Phase 1 감사가 찾았던 23개는 페이지네이션 백필로 이미 복구됨 |
| 매매 셀 중 1,000행 초과 | 23개 (최대 2,442) | 복구된 셀들 — 페이지네이션이 실제로 동작한 증거 |
| 전월세 셀 중 1,000행 초과 | 2개 (최대 1,047) | 대량 경로가 부산에서도 이미 2페이지를 읽었다 |
| 커버리지 셀 `fetched < totalCount` | **0건** | 대량 경로는 절단을 남기지 않았다 |

### 페이징 동작 검증

전월세 강남구 202603(totalCount 2,091)의 **마지막 페이지(pageNo=3, numOfRows=1000)**를 직접 호출:

```
totalCount 2091 · pageNo echo 3 · itemCount 91 · expected 91 → pagingWorks: true
```

**서버의 페이징은 정상이다. 문제는 전적으로 클라이언트가 1페이지만 읽는 것이다.**

---

## 3. 대표 지역 probe 결과

`numOfRows=1`로 totalCount만 조회(페이로드 최소화). 모두 HTTP 200 / resultCode 0.

### 매매 (RTMSDataSvcAptTradeDev)

| 지역 | lawdCd | 202608 | 202603 | 페이지@1000 | >1000 |
|---|---|---|---|---|---|
| 서울 강남구 | 11680 | 81 | 180 | 1 | 아니오 |
| 서울 송파구 | 11710 | 149 | 286 | 1 | 아니오 |
| 서울 마포구 | 11440 | 102 | 158 | 1 | 아니오 |
| 경기 성남시 분당구 | 41135 | 145 | 245 | 1 | 아니오 |
| 경기 수원시 영통구 | 41117 | 377 | **577** | 1 | 아니오 |
| 경기 고양시 일산서구 | 41287 | 200 | 273 | 1 | 아니오 |
| 경기 김포시 | 41570 | 353 | 529 | 1 | 아니오 |
| 부산 서구 | 26140 | 62 | 117 | 1 | 아니오 |
| 부산 해운대구 | 26350 | 272 | 387 | 1 | 아니오 |
| 부산 연제구 | 26470 | 153 | 273 | 1 | 아니오 |

### 전월세 (RTMSDataSvcAptRent)

| 지역 | lawdCd | 202608 | 202603 | 최대 페이지@1000 | >1000 |
|---|---|---|---|---|---|
| 서울 강남구 | 11680 | **1,050** | **2,091** | **3** | **예** |
| 서울 송파구 | 11710 | **1,128** | **1,873** | **2** | **예** |
| 서울 마포구 | 11440 | 741 | **1,150** | **2** | **예** |
| 경기 성남시 분당구 | 41135 | 769 | **1,358** | **2** | **예** |
| 경기 수원시 영통구 | 41117 | 576 | 906 | 1 | 아니오 |
| 경기 고양시 일산서구 | 41287 | 463 | 764 | 1 | 아니오 |
| 경기 김포시 | 41570 | 858 | **1,061** | **2** | **예** |
| 부산 서구 | 26140 | 90 | 102 | 1 | 아니오 |
| 부산 해운대구 | 26350 | 485 | 714 | 1 | 아니오 |
| 부산 연제구 | 26470 | 181 | 331 | 1 | 아니오 |

### 지역별 셀 평균 (probe 2개월 평균)

| 지역 | 구 수 | 매매 평균 | 매매 페이지/셀 | 전월세 평균 | 전월세 페이지/셀 |
|---|---|---|---|---|---|
| 서울 | 25 | 159 | 1.00 | **1,339** | **2.00** |
| 경기 | 42 (leaf) | 337 | 1.00 | 844 | 1.25 |
| 부산 | 16 | 211 | 1.00 | 317 | 1.00 |

> 202603은 봄 성수기, 202608은 평월. 둘의 평균을 연평균 프록시로 쓴다 — 실제 연평균은 이보다 다소 낮을 수 있다(보수적 추정).

---

## 4. page size

| 요청 numOfRows | totalCount | 반환 item | 서버 echo | 응답 크기 | latency |
|---|---|---|---|---|---|
| 100 | 577 | 100 | 100 | 82 KB | 90ms |
| 1000 | 577 | **577** | 1000 | 465 KB | 443ms |

서버는 `numOfRows`를 그대로 존중하고 응답 body에 echo한다. 1000 요청 시 남은 577건을 모두 돌려준다. **현행 관행값 1000은 적절하다** — 페이지 수를 최소화해 quota 소모를 줄인다. 1000 초과는 시도하지 않았다(과도한 probe 금지 + 공식 상한 미확인).

---

## 5. rate limit · quota 증거

### 응답 헤더 (실측)

```
x-ratelimit-limit:     10000
x-ratelimit-remaining: (호출마다 정확히 1씩 감소)
server: Apache · content-type: application/xml;charset=utf-8
```

`x-ratelimit-reset`, `retry-after`, `x-quota-*` 헤더는 **존재하지 않는다.**

### 핵심 관측 — 카운터는 endpoint별로 독립이다

같은 실행(17초) 안에서 두 카운터가 따로 움직였다:

| 순서 | endpoint | 첫 remaining | 마지막 remaining | 호출 | 감소 |
|---|---|---|---|---|---|
| 1~20 | 매매 | 9,882 | 9,863 | 20 | 19 |
| 21~40 | 전월세 | **9,967** | 9,948 | 20 | 19 |

전월세가 9,948에서 시작하지 않고 **9,967에서 시작**했다 = 매매 호출이 전월세 카운터를 소모하지 않았다. **한도 10,000은 오퍼레이션마다 따로 있다.**

4분 뒤 재실행 시 매매 9,860 / 전월세 9,947에서 이어졌다 — 카운터는 분 단위로 리셋되지 않는다.

### quota 창(window)

- **확인된 것**: 한도 10,000, endpoint별, 호출당 1 감소, 분 단위 리셋 없음.
- **확인되지 않은 것**: 리셋 주기. 헤더에 reset이 없고, 이번 STEP에서 소진 실험을 하지 않았다.
- 정황: probe 시작 시점(10:32 KST)에 매매가 이미 118건 소모돼 있었다 — 그날 00시부터의 cron·라이브 트래픽과 일치하는 규모. data.go.kr의 통상 모델도 일 단위다.
- **이 문서는 "일일 10,000"을 공식 확인된 사실로 주장하지 않는다.** 아래 비용 모델은 "endpoint당 창당 10,000"으로 계산하고, 창이 하루보다 길더라도 안전하도록 §8에 시나리오를 둔다.

### 초당 제한 — 실제로 관측됨

Production `error_logs` 최근 30일:

| 유형 | 건수 | 최근 |
|---|---|---|
| **RATE_LIMIT (초당 요청제한)** | **91** | 2026-09-11 |
| NON_MOLIT | 15 | 2026-09-05 |
| TIMEOUT | 6 | 2026-09-06 |
| 합계(30일) | 112 | — |

전체 기간 121건(2026-08-14~). 일일 한도 초과 흔적은 **0건** — 문제는 초당 버스트이지 일일 총량이 아니다.

---

## 6. 호출량 비용 모델

페이지네이션 반영. 구 수는 이전 audit §2 기준(서울 25 leaf, 경기 **42 leaf** — 48개 코드 중 부모 시 코드 6개 제외, 부산 16). **부모 시 코드로는 호출하지 않는다**(중복 호출 방지).

### 현재 부산 일일 sync

`vercel.json` cron 3종 + 코드 루프 기준:

| cron | 시각(KST) | 범위 | 셀 | 페이지/셀 | requests |
|---|---|---|---|---|---|
| sale-sync | 04:00 | 16구 × 4개월(overlap 3 + 현재월) | 64 | 1.0 | **64** |
| rent-sync | 06:00 | 16구 × 2개월(overlap 2) | 32 | 1.0 | **32** |
| sale-recheck | 08:00 | 16구 × 10개월(3~12개월 전 band), 45초 예산 | 160 | 1.0 | **≤160**(예산 내에서만) |

부산 일일 합계 **약 96~256 requests**, endpoint별로는 매매 ≤224 / 전월세 32. 한도 10,000 대비 **2.2% / 0.3%**.

### 확장 후 증분(일일)

| 지역 | 매매(4개월) | 전월세(2개월) |
|---|---|---|
| 서울 25구 | 100 | 200 |
| 경기 42구 | 168 | 210 |
| 부산 16구 | 64 | 64 |
| **합계** | **332** | **474** |

**매매 endpoint 332/10,000 (3.3%) · 전월세 endpoint 474/10,000 (4.7%).** recheck를 더해도 여유가 크다.

### 백필

| 범위 | 매매 requests | 전월세 requests | 합계 | 매매 한도 대비 | 전월세 한도 대비 |
|---|---|---|---|---|---|
| 12개월 | 996 | 1,422 | 2,418 | 10.0% | 14.2% |
| 3년 | 2,988 | 4,266 | 7,254 | 29.9% | 42.7% |
| **5년** | **4,980** | **7,110** | **12,090** | **49.8%** | **71.1%** |

지역별 5년:

| 지역 | 매매 | 전월세 |
|---|---|---|
| 서울 25구 | 1,500 | 3,000 |
| 경기 42구 | 2,520 | 3,150 |
| 부산 16구 | 960 | 960 |

**부산+서울+경기 5년 전체 백필이 endpoint당 한 창(10,000) 안에 들어간다.** 이전 audit이 "1~3주, 한도 의존"으로 잡았던 D·E STEP의 근거가 바뀐다.

### 예상 runtime

실측 latency(매매 페이지 ~170ms, 전월세 페이지 ~250~440ms) + 대량 fetcher 간격 350ms 기준:

| 범위 | requests | 동시 1 | 동시 2 | 동시 4 |
|---|---|---|---|---|
| 일일 증분 | 806 | 8분 | 6분 | 4분 |
| 12개월 | 2,418 | 24분 | 17분 | 13분 |
| 3년 | 7,254 | 1.2시간 | 51분 | 40분 |
| **5년** | **12,090** | **2.0시간** | **1.4시간** | **1.1시간** |

**동시 1(부산에서 검증된 보수적 설정)으로도 5년 전체가 약 2시간이다.** 초당 제한 91건 관측을 감안하면 동시성을 올릴 이유가 없다 — 동시 1을 권장한다.

### quota 시나리오

창 주기가 확인되지 않았으므로 한도 자체를 시나리오로 둔다(§13 요구). **공식 확인값이 아니다.**

| 시나리오 | 서울 12m | 서울 5y | 경기 12m | 서울+경기 5y |
|---|---|---|---|---|
| Q1 = 1,000/창 | 1창 | 5창 | 2창 | 9창 |
| **Q2 = 10,000/창 (헤더 실측값)** | **1창** | **1창** | **1창** | **2창** |
| Q3 = 100,000/창 | 1창 | 1창 | 1창 | 1창 |

> endpoint별 독립 카운터라 매매/전월세를 병렬로 돌리면 창 수가 더 줄어든다. Q2(실측)에서 **전체 확장 백필은 2창 = 창이 하루라면 이틀**이다.

---

## 7. 동시성 현황

| 경로 | 동시성 | 간격 | 백오프 | 차단기 |
|---|---|---|---|---|
| 라이브 (`molit-rate-guard.ts:67`) | **4** (인스턴스당) | 250ms + 적응형 최대 +800ms | 4회 시도 / 8초 예산 | 5초 프로브, 잠금 중 호출 없음 |
| 대량 sync | **1** | 350ms | 페이지당 5회, rate-limit 시 2s→10s | 없음(재시도로 흡수) |

라이브 게이트는 `interactive`/`bulk` 2개 lane, 동일 `(type, lawdCd, dealYmd)` in-flight dedup, 성공 20회 연속 시 쿨다운 완화. **인스턴스당**이므로 Vercel 인스턴스가 늘면 합산 동시성은 4를 넘는다 — 관측된 91건의 초당 제한과 일치한다.

---

## 8. 커버리지 셀 — paging 표현 가능성

**결론: 대량 경로의 커버리지 셀은 paging을 정확히 표현한다.** §15에서 우려한 "1페이지만 읽고 complete 처리" 위험은 대량 경로에 **없다**.

`scripts/sale-pagination-logic.ts:27`
```
firstPageFailed || totalCount === null  → INVALID
totalCount === 0                        → EMPTY_VALID
anyLaterPageFailed || collected < total → PARTIAL
그 외                                   → COMPLETE
```

`sync_coverage_cells`는 `source_total_count` / `fetched_count` / `status`를 모두 보존하고, `sale-sync-core.ts:85`는 진행 중인 현재월을 커버리지에 기록하지 않는다.

Production 확인:

| 항목 | 값 |
|---|---|
| 커버리지 셀 상태 | SALE 208 COMPLETE · RENT 32 COMPLETE (PARTIAL/INVALID 0) |
| `fetched_count < source_total_count` 인 셀 | **0** |
| 관측된 최대 `source_total_count` | SALE 532 · RENT 634 |

**다만 주의**: 지금까지 기록된 커버리지 셀의 `source_total_count`는 **최대 634로, 1,000을 한 번도 넘은 적이 없다.** 즉 **커버리지 회계는 다중 페이지 셀을 아직 한 번도 겪지 않았다.** 로직상 올바르지만 서울 규모에서의 실증은 없다 — 서울 첫 백필에서 `pagesFetched > 1`인 셀의 `fetched == total` 여부를 반드시 검증해야 한다.

### 서울 11680 파일럿 46행과의 관계

이전 audit의 "강남구 매매 46행(부분 월, 커버리지 셀 0)"은 **paging 문제가 아니다.** 강남구 매매 2026-08은 totalCount 81로 1페이지에 들어간다. 46행은 라이브 경로가 만든 파일럿 잔여물이며 커버리지 셀이 0이므로 "검증됨"으로 오인될 위험도 없다. **절단이 아니라 미수집이다.**

---

## 9. 데이터 손실 위험 분류

| # | 케이스 | 현재 완화 | 잔여 위험 | 서울/경기 영향 |
|---|---|---|---|---|
| **A** | **paging 없음 → 조용한 절단** | 대량 경로만 해결. 라이브 경로 **미해결** | **높음** | **실현됨** — 서울 전월세 6/20 셀이 1,000 초과, 최대 52% 누락 |
| B | timeout → 부분 | 라이브 5s/대량 10s, `apt-trade-completeness`가 FAILED를 사용자에게 노출 | 낮음 | 30일 6건. 절단은 감지 못함 |
| C | rate limit → 부분 | 게이트+차단기+백오프, FAILED로 구분 | 중간 | 30일 91건. 인스턴스 증가 시 악화 |
| D | 차단기 → 지역 건너뜀 | 5초 프로브 후 복귀, 0건으로 기록하지 않음 | 낮음 | 사용자에게 부분 실패로 표시됨 |
| **E** | **고정 순서 + 50초 예산 → 뒤쪽 구 기아** | `districtOffset` 파라미터 존재 | **높음** | **83구는 한 cron에 불가.** `vercel.json`이 offset을 안 넘기고 저장할 곳도 없음 |

### E의 정량화

| | 셀 수 | 50초 예산 안에 들어가는가 |
|---|---|---|
| 부산 16구 매매(4개월) | 64 | 예(빠듯함) |
| **83구 매매(4개월)** | **332** | **아니오 — 약 1/5만 처리** |
| **83구 전월세(2개월)** | **166** | **아니오** |

`maxDuration = 60`(Vercel) · `TimeBudget(50_000)` · `ESTIMATED_CELL_MS 2500`. 예산은 셀 수가 아니라 **경과 시간**으로 끊으므로 실측 셀 시간(~0.5초)에서는 부산 64셀이 들어가지만, 332셀은 어떤 셋팅으로도 60초에 들어가지 않는다.

**그리고 `SyncRun` 테이블이 없다** — 실행 상태가 Vercel 로그에만 남아 offset 회전·재개 커서를 저장할 곳이 없다.

---

## 10. 권장 sync 아키텍처 (제안만 — 코드 수정 없음)

부산 구조에서 **무엇이 달라져야 하는지**만 명시한다.

| 항목 | 부산 현재 | 확장 시 필요 | 이유 |
|---|---|---|---|
| **paginated fetch** | 대량 O / 라이브 X | **라이브 경로도 totalCount 인지** — 최소한 절단을 *감지*해 `truncated: true`를 노출 | A. 라이브 절단은 데이터 진실성 위반 |
| **resumable cursor** | 없음 (offset 파라미터만) | `(dataset, lawdCd, dealYmd, pageNo)` 커서를 DB에 영속화 | E. 60초 안에 못 끝내므로 재개가 필수 |
| **회전 보장** | 고정 순서 | `verified_at` 오래된 셀 우선(= sale-recheck가 이미 쓰는 방식을 sync에도) | E. 뒤쪽 구 영구 기아 방지 |
| **per-region completeness** | 커버리지 셀 O | 그대로 + `pagesFetched` 기록 | 다중 페이지 셀 실증이 없음(§8) |
| **retry queue** | 인라인 5회 | PARTIAL/INVALID 셀을 별도 큐로 → 다음 실행 최우선 | C·D |
| **bounded concurrency** | 동시 1 · 350ms | **유지**. 올릴 이유 없음(5년 2시간) | 초당 제한 91건 |
| **quota 계측** | 없음 | `x-ratelimit-remaining`을 읽어 로그/대시보드에 기록 | 헤더가 실제로 존재한다 |
| **checkpointing** | 없음 | `SyncRun` 테이블(run_id, 상태, 커서, 소모 requests) | **schema 추가 필요 → 승인 대상** |
| **실행 위치** | Vercel cron 60s | 백필은 **로컬/장시간 러너**(부산 방식), cron은 증분만 | 5년 백필 2시간 ≫ 60초 |

---

## 11. Production write · schema

- **이번 STEP Production write: 0.** DB는 `SET TRANSACTION READ ONLY` 트랜잭션에서 SELECT/집계만. migration·schema 변경 0. region enable·sitemap enable·cron 변경 0.
- **MOLIT 호출: 43건(GET 조회만).** 매매 endpoint 22 · 전월세 endpoint 21. 소모 quota는 endpoint당 약 0.2%.
- **다음 STEP에서 필요할 schema 변경(승인 대상)**: `SyncRun`(재개 커서·실행 상태) 테이블 추가. 커버리지 셀에 `pages_fetched` 컬럼 추가는 선택. **둘 다 이번 STEP에서 하지 않았다.**

---

## 12. 검증

```
scripts/audit-molit-quota-scale-probe.ts   exit 0, 43 requests, 17s, stopped=null (제한 신호 없음)
scripts/audit-molit-quota-log-read.ts      ALLOW_PROD_DB_READ=1, READ ONLY 트랜잭션, exit 0
npx eslint (신규 스크립트 2개)              exit 0
npx tsc --noEmit                           신규 스크립트 오류 0
                                           나머지 25건은 기존 scripts/·tmp/ 오류 → FAIL_EXISTING_SCRIPT_ERRORS
mutation grep (INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/upsert/createMany/updateMany)
                                           0건 (executeRaw는 SET TRANSACTION READ ONLY · SET LOCAL statement_timeout 2건뿐)
앱 코드 변경 없음 → build 생략
```

임시 출력 파일은 세션 scratchpad에만 두었고 저장소에는 남기지 않았다. 사용자 기존 `tmp/` 파일은 건드리지 않았다.

---

## 13. 알려진 한계

- **quota 창 주기 미확인.** 한도 10,000·endpoint별·호출당 1 감소는 실측이지만, 리셋 주기는 헤더에 없고 소진 실험을 하지 않았다. 일 단위라는 정황만 있다.
- probe는 **2개월(202608 평월 · 202603 성수기) × 10개 구**다. 과거 호황기(2020~2021) 월은 더 클 수 있어 5년 백필의 페이지/셀은 이 추정보다 높을 수 있다 — 특히 매매.
- 경기 42 leaf는 이전 audit의 코드 목록 기준이며, **부모 시 코드로 호출했을 때의 MOLIT 동작은 이번에도 확인하지 않았다**(중복 호출 방지 위해 호출하지 않음).
- 다중 페이지 셀에 대한 커버리지 회계는 로직상 올바르나 Production 실증이 없다(최대 관측 totalCount 634).
- `ESTIMATED_CELL_MS`(2500)는 실측 셀 시간(~500ms)보다 5배 보수적이라 예산을 실제보다 일찍 끊는다 — 부산에서는 아직 문제되지 않으나 확장 시 튜닝 대상.
- 오피스텔·분양권·빌라 endpoint는 이번 probe 범위 밖이다.
