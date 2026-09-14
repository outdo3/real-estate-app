# GAP INVEST BUSAN DB-FIRST V1

출시 전 P1 blocker 수정. `/stats/gap-invest` 부산 전체(기본 지역) 콜드 34~38초.

- 기준 HEAD: `4aedd0d` (main)
- 범위: `/api/stats/gap-invest` **시도 전체 경로만**. 단일 구 경로·다른 통계 route·집계 공식·기간/지역 의미·
  취소 의미는 바꾸지 않았다. DB schema/migration/write 0, 신규 cron 0, backfill 0.

## 1. 목적

부산 전체 12개월 원본 수집이 MOLIT 384회 호출이라 콜드가 30초를 넘는다. 검증된 DB 셀만 DB에서 읽어
외부 호출을 최소화하되, 결과 의미는 그대로 둔다.

## 2. 근본 원인 (구 아키텍처)

| 항목 | 값 |
|---|---|
| 기본 지역 | 부산 전체(`sidoCode=26`), 기본 period `3m` |
| 수집 창 | period와 무관하게 항상 최근 12개월(현재월 포함) |
| 매매/전월세 | MOLIT `apt` / `rent` 월 조회 |
| loop | 16개 구 × 12개월 × 2타입 = **384 호출** |
| 게이트 | 공유 molit-rate-guard 동시 4 / 250ms, 통계는 bulk lane(`8c3d0c5`) |
| 캐시 | 인스턴스 메모리 5분(`stats-gap-invest-sido:26`) + fetch `revalidate: 3600` |
| 완전성 | MOLIT task 하나라도 실패한 구 → `failedDistricts`/`partial`, 16구 전부 실패 → `apiError` |
| 취소 | `toGapTrade` 후 `!dealCanceled`로 매매·전세 모두 제외(매칭 전) |
| 0건 | 성공 응답 0건은 0건. 단일 구에서만 API 실패 vs 0건 probe 1회 |

호출 수가 곧 벽시계 시간이다. 로컬 재현(같은 게이트): **384 호출 44.98s / 47.99s**, 실패 셀 0.
production 기준선(FINAL_PRELAUNCH_REGRESSION_AUDIT_V2): 콜드 34.18s / 37.74s, 웜 0.67s.

## 3. DB coverage (read-only, 2026-09-14 기준)

`scripts/audit-gap-invest-db-first-coverage.ts`

| 월 | 매매 구 | 매매 행 | 취소 | 전월세 구 | 전월세 행 | 순수전세 | SALE 셀 | RENT 셀 |
|---|---|---|---|---|---|---|---|---|
| 202510 | 16/16 | 3,529 | 207 | 16/16 | 4,608 | 2,233 | COMPLETE 16 | (bootstrap) |
| 202511 | 16/16 | 4,099 | 275 | 16/16 | 5,528 | 2,963 | COMPLETE 16 | (bootstrap) |
| 202512 | 16/16 | 3,421 | 201 | 16/16 | 5,874 | 3,079 | COMPLETE 16 | (bootstrap) |
| 202601 | 16/16 | 3,644 | 236 | 16/16 | 5,877 | 3,127 | COMPLETE 16 | (bootstrap) |
| 202602 | 16/16 | 2,773 | 144 | 16/16 | 4,853 | 2,225 | COMPLETE 16 | (bootstrap) |
| 202603 | 16/16 | 3,436 | 177 | 16/16 | 5,170 | 2,678 | COMPLETE 16 | (bootstrap) |
| 202604 | 16/16 | 3,034 | 149 | 16/16 | 4,781 | 2,341 | COMPLETE 16 | (bootstrap) |
| 202605 | 16/16 | 2,911 | 139 | 16/16 | 4,052 | 2,065 | COMPLETE 16 | (bootstrap) |
| 202606 | 16/16 | 2,773 | 127 | 16/16 | 4,117 | 2,182 | COMPLETE 16 | (bootstrap) |
| 202607 | 16/16 | 2,546 | 95 | 16/16 | 3,994 | 2,052 | COMPLETE 16 | COMPLETE 16 |
| 202608 | 16/16 | 2,148 | 67 | 16/16 | 3,294 | 1,661 | COMPLETE 16 | COMPLETE 16 |
| 202609 (현재월) | 16/16 | 613 | 14 | 0/16 | 0 | 0 | 셀 없음 | 셀 없음 |

- 매매: 완료월 11개월 × 16구 = 176 셀 전부 COMPLETE. sync 엔진은 현재월을 절대 기록하지 않는다
  (`sale-sync-core` §15) → 현재월은 검증 안 됨.
- 전월세: 검증범위 `202408~202608`(legacyBootstrap + coverage 전진). 현재월은 범위 밖.
  bootstrap 구간(202510~202606)은 coverage 셀이 없다 — manifest 기록상 "re-verification 없이 bootstrap".
- `deal_ymd ≠ month(deal_date)` 매매 행: 창 안 0건(셀 버킷팅 근거).

## 4. 설계 결정

**검증된 셀 → DB, 나머지 → MOLIT.** "DB에 행이 있다"는 근거로 쓰지 않는다.

| 데이터 | DB로 읽는 조건 | 근거 함수 |
|---|---|---|
| 매매 | `sync_coverage_cells(SALE)`의 (구, 월) 셀이 COMPLETE/EMPTY_VALID | `loadVerifiedSaleCellKeys` (신규, `isVerifiedCellStatus` 재사용) |
| 전월세 | 월이 `getRentVerifiedRange()` 안(16/16 구 공통) | 피드·대시보드와 같은 함수 |
| 현재월 | 증거와 무관하게 **절대 DB 아님** | planner가 독립 강제 |
| 부산 외 시도 | 전부 MOLIT(기존과 task 키·순서까지 동일) | `isFeedDbBackedSido` 재사용 |

- 매매는 피드/대시보드(부산 매매 월 구분 없이 DB)보다 **보수적**이다. 요구사항("DB에 있으니까 충분" 금지)에
  맞춰 셀 단위 증거를 요구했다. 피드/대시보드 정책은 건드리지 않았다.
- DB 원본은 피드의 기존 primitive(`getRegionalSaleRowsForFeedFromDb`, `fetchRentMonthBucketsFromDb`,
  `storedSaleToFeedRaw`, `storedRentToFeedRaw`, `monthRangeBounds`, `warmupConnections`)로만 읽는다. 새 SQL 없음.
- 날짜 범위 쿼리에 걸린 **미검증 셀 행은 버린다**(같은 셀을 두 소스에서 세지 않음, 다른 달/구로 채우지 않음).
- 취소 행은 DB에서 거르지 않고 `dealCanceled` 원값을 싣는다. 제외는 기존과 같은 `toGapInputs` 한 곳.
- 남은 MOLIT task는 기존 `fetchMonthsThrottledWithStatus`(bulk lane)로 DB 쿼리와 **병렬** 실행.
- 실패 의미:
  - MOLIT task 실패 구 → `failedDistricts`/`partial` (기존 동일)
  - `apiError` = 16구 전부 실패 **그리고** DB 셀 0 (`resolveSidoApiError`). DB 결과가 있는데 현재월 MOLIT만
    전부 실패하면 화면을 에러로 숨기지 않고 partial로 표시 — `/api/stats/feed` DB 경로와 같은 규칙.
  - SALE coverage 조회 실패 → 매매 전 셀 MOLIT으로 **좁힘**(로그). DB 행 쿼리 실패 → throw → 500 ERROR.
    MOLIT 전체로 조용히 되돌아가지 않는다.
- 집계 로직을 라우트에서 `src/lib/stats/gap-invest-insights.ts`로 **의미 불변 이동**했다(정규화 diff: 타입 선언
  위치, `sort` 인자 전달 두 줄만 다름). parity 감사와 테스트가 두 소스를 같은 함수로 계산하기 위함.
- 응답: 기존 필드 전부 유지 + 추가 전용 `dataSource`(시도 전체만, 단일 구는 `null`):
  `{ mode, sale/rent: { dbCells, molitCells, dbMonths, molitMonths, dbRows }, molitCalls }`.
- 메모리 캐시 키 `stats-gap-invest-sido:v2:{sido}:{months}` (TTL 5분 불변).

## 5. 구현 파일

| 파일 | 변경 |
|---|---|
| `src/app/api/stats/gap-invest/route.ts` | 시도 전체 수집을 loader로 교체, 집계 호출을 모듈로 교체, `dataSource` 추가. 단일 구 경로 동일 |
| `src/lib/stats/gap-invest-db-source.ts` | 신규 — planner(순수) / loader(주입 deps) / `resolveSidoApiError` |
| `src/lib/stats/gap-invest-insights.ts` | 신규 — 라우트 집계 코드 이동 |
| `src/lib/sync-coverage.ts` | `loadVerifiedSaleCellKeys` 추가(read-only) |
| `src/lib/stats/gap-invest-db-source.test.ts` | 신규 15 tests |
| `scripts/audit-gap-invest-db-first-coverage.ts` | coverage 감사(read-only) |
| `scripts/audit-gap-invest-db-first-parity.ts` | MOLIT vs DB-first parity 감사(DB read-only) |

## 6. MOLIT 호출 수

| | 호출 |
|---|---|
| 기존 부산 전체 | **384** |
| DB-first 부산 전체(현재 coverage) | **32** (현재월 매매 16 + 전월세 16) |
| 부산 외 시도 전체 | 384 (불변) |
| 단일 구 | 24 (불변) |

월초에 직전 달 셀이 아직 COMPLETE가 아니면 그 달도 자동으로 MOLIT(최대 64)로 읽힌다.

## 7. Parity (production DB read-only vs live MOLIT, 2026-09-14)

방법: MOLIT 384 호출을 1회(재현 1회 추가) 수집하고, DB-first 실행의 현재월 32 task는 그 결과를 재생했다.
따라서 차이는 **완료월 11개월의 DB vs MOLIT**만 남는다. 두 경로 모두 라우트와 같은 loader/집계 함수.
2회 수집에서 행 차이는 동일(16/9, 63/3) — 일시적 흔들림이 아니다.

### 7.1 거래 수 (12개월, 부산 전체)

| | MOLIT | DB-first | 차이 |
|---|---|---|---|
| 매매 전체 행 | 34,912 | 34,926 | +14 |
| 매매 취소 | 1,810 | 1,831 | +21 |
| 매매 활성 | 33,102 | 33,095 | −7 (−0.02%) |
| 전월세 행 | 53,120 | 53,002 | −118 |
| 순수 전세 | 27,167 | 27,107 | −60 (−0.22%) |
| 결측 월 | 0 | 0 | — |

### 7.2 행 단위 원인 (전부 식별, 추정 없음)

1. **매매 과다취소(래칫) 16행** — MOLIT은 활성, DB는 같은 키(구·aptSeq·면적·계약일·금액)가 취소로만 존재.
   APARTMENT_TRADE_SYNC_COVERAGE_AUDIT_V1 §7.2의 기존 결함(취소 flip 되돌림 차단). DB-first는 이 16건을
   **제외**한다(과소집계 방향). 202608에 9건 집중.
2. **DB 전용 활성 매매 9행** — 원천이 현재 반환하지 않는 행. 그중 `26140-1361 59.984 2026-08-27 3층`은
   원천에서 같은 날짜·층 금액이 40,090 → 38,285로 정정된 것이 확인됨. 나머지 8행은 ±45일 안에 같은
   날짜 행이 원천에 없음(회수/정정 — 원천이 이유를 주지 않아 둘 중 무엇인지는 판별 불가).
   기존 결함 B(회수 행 잔존)와 같은 부류.
3. **취소 부활: 0건.** DB 전용 활성 9행 중 원천에서 같은 키 또는 ±45일 같은 단지·면적이 취소로 표시된 행 없음.
4. **전월세 원천 전용 122행(순수전세 63)** — 해당 DB 셀 147/176개의 마지막 수집(`source_fetched_at`)이
   2026-09-02이고, 원천은 오늘 그보다 122행 많다. 월 분포가 창 전체에 퍼져 있다(202606 31, 202605 18,
   202510 12, …). 2026-09-02 수집 당시 누락인지 이후 원천 추가인지는 bootstrap 구간에 coverage 셀
   (`sourceTotalCount`)이 없어 **판별 불가**. 전월세 recheck sweep 부재(post-launch P1 "RENT RECHECK SWEEP")와
   같은 원인 계열. 예: `26230-2866 양정포레힐즈스위첸1단지` 원천 97행 중 DB 80행.
5. DB 전용 순수전세 3행.
6. name/dong 표시 필드 불일치: 0 (키 차이와 동일 수).

### 7.3 결과 parity

지역 랭킹 순서는 부산 전체 4개 period + 표본 4개 구 × 4 period, 총 20개 조합 중 해운대구 3m 1곳(동 2·3위, 우동 갭 −3)만 달랐다.

입력 순서만 바꾼 MOLIT vs MOLIT도 **단지 랭킹 동점 처리가 달라진다**(같은 gap 단지의 순서, 같은 계약일
전세가 여러 건일 때 선택된 전세가 — 예: 대림타운 32,500 vs 32,400). 요약·지역랭킹·월별추이는 순서와 무관.
MOLIT 응답 순서 자체가 호출마다 바뀌므로(§7.2 감사) 이것은 **기존 경로에도 있는 흔들림**이다. 그래서
행 내용 차이는 두 소스를 같은 결정적 순서로 정렬해서 비교했다.

| 범위 | 요약(판매, 갭, 비율) | 지역 랭킹 순서 | 단지 TOP30 |
|---|---|---|---|
| 부산 전체 30d | 1,694→1,690, 984→980, 58.1→58.0% | 동일(구별 값 ±1) | 동일 |
| 부산 전체 **3m(기본)** | 6,633→6,630, 4,318→4,310, 65.1→65.0% | 동일 | 동일 |
| 부산 전체 6m | 15,400→15,395, 10,635→10,623, 69.1→69.0% | 동일 | 동일 |
| 부산 전체 12m | 33,102→33,095, 23,597→23,580, 71.3→71.2% | 동일 | 동일 |
| 서구 3m | 203→206, 95→95 | 동일(값 ±1) | #13·#14 순서 교체 |
| 해운대구 3m | 827→825, 633→629 | **우동 124→121 / 반여동 123 — 2·3위 교체** | #29 이탈, #30 신규 |
| 강서구 3m | 331→330, 275→274 | 동일(값 ±1) | 동일 |
| 기장군 3m | 350→349, 261→260 | 동일(값 ±1) | #10 median 850→1,000 |

월별 추이(항상 12개월) 부산 전체: MOLIT `2327,2766,2397,2611,1932,2353,2092,1989,1871,1636,1291,332` →
DB-first `2326,2765,2397,2610,1930,2353,2089,1989,1871,1634,1284,332` (현재월 동일).

단지 랭킹 차이 역추적(모두 확인):
- 서구 대신더샵(`26140-1245` 59.93): DB 전용 순수전세 `2026-08-04 29,000`(§7.2-5)이 더 가까운 전세로 선택돼
  gap 9,800→10,800 → #13·#14 교체.
- 해운대구 삼정코아(`26350-190` 36.9336): 원천 전용 순수전세 `2026-06-21 17,000 3층`(§7.2-4, DB에 없음 확인)
  이 없어 해당 매매가 갭 이벤트가 되지 못함 → #29 이탈.
- 기장군 가화만사성정관타운(`26710-549` 59.9437): 과다취소 `2026-08-28 16,700`(§7.2-1) 1행 제외로 n 2→1.



## 8. 성능

### 8.1 로컬(`next start`, 로컬 → Supabase/MOLIT)

| | 콜드 | 웜 |
|---|---|---|
| 기존(MOLIT 384) — 원본 수집만 | 44.98s / 47.99s | — |
| DB-first 원본 수집(스크립트, DB만) | 2.86s / 3.99s | — |
| DB-first 라우트 부산 3m | 5.85s (새 프로세스) | 1.21s |
| DB-first 라우트 부산 12m (재시작 후) | 5.63s | 1.38s |
| 단일 구 서구 3m(불변 경로) | 1.99s | 0.11s |

### 8.2 Production

| | 기존(384) | DB-first(32) |
|---|---|---|
| cold | 34.18s / 37.74s | **5.09s** 단독 TTL 만료, 5.35s 배포 직후, 7.01s 상세 동시 |
| warm | 0.67s | **0.70~0.99s** |

상세는 §11.

## 9. 로컬 검증 중 확인한 기존 동작 (이번 변경 무관)

첫 로컬 서버 요청이 스크립트보다 매매 71건 적었다(9월만). 원인: `fetchMolitData`의
`fetch(..., { next: { revalidate: 3600 } })` — Next Data Cache가 전날 저장된 현재월 MOLIT 응답을 stale로
먼저 주고 백그라운드 갱신했다(`.next/cache/fetch-cache` 파일 시각으로 확인). 서버 재시작 후 같은 요청은
스크립트와 완전히 일치(33,095 / 23,580, 월별추이 동일). 기존 384 경로에도 똑같이 적용되는 동작이며 이번
STEP에서 바꾸지 않았다.

## 10. 테스트

`src/lib/stats/gap-invest-db-source.test.ts` 15/15:
1 검증 월 DB · 2 미검증 월 MOLIT · 3 현재월 정책 · 4 취소 제외 유지 · 5 다른 달 fallback 없음 ·
6 다른 구 fallback 없음 · 7 coverage 실패 시 MOLIT/partial · 8 응답 필드 유지 · 9 같은 거래 → 같은 순위 ·
10 검증된 0건 · 11 오류 의미 · 12 부산 전체 경로 · 13 단일 구 회귀 · 14 384→32 / 부산 외 384 동일 ·
15 bulk lane·동시성 4 유지.

| 명령 | 결과 |
|---|---|
| `npx tsx --test src/lib/stats/gap-invest-db-source.test.ts` | 15/15 pass |
| `npx tsx --test` (src 전체 test 파일) | **1784/1784 pass** |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS — 25건 전부 `scripts/`·`tmp/` 기존 파일, src 0 |
| `npx eslint` (변경 파일 7개) | exit 0 |
| `npm run build` | exit 0 |

## 11. Production 측정 (e-jip.com, `7a8c965`, Vercel 배포 성공 00:48:57 UTC)

순차 GET만 사용(stress 없음). 모든 부산 전체 응답: `status OK`, `apiError false`, `partial false`,
`dataSource.mode DB_FIRST`, `molitCalls 32`, 매매·전월세 DB 11개월, MOLIT `202609`만, DB 행 매매 34,314 / 전월세 52,148.

| 시각(UTC) | 요청 | 시간 | 결과 |
|---|---|---|---|
| 00:49:10 | 부산 3m — 배포 직후 첫 요청(함수 cold start 포함) | **5.35s** | 판매 6,631 / 갭 4,310 / 65.0% |
| 00:49:12 | 부산 3m warm | 0.99s | 동일 |
| 00:49:13 | 부산 3m warm | 0.91s | 동일 |
| 00:49:14 | 부산 12m (같은 원본 캐시) | 0.76s | 33,096 / 23,580 / 71.2% |
| 00:49:15 | 부산 30d sort=rate | 0.90s | 1,691 / 980 / 58.0% |
| 00:54:51 | 부산 3m — TTL 만료 후 cold + 1초 뒤 상세 전월세 60m 동시 | **7.01s** | 6,630 / 4,310 |
| 00:54:53 | 부산 3m warm | 0.70s | 동일 |
| 01:00:19 | 부산 3m — TTL 만료 후 cold(단독) | **5.09s** | 6,630 / 4,310 |
| 01:00:20 | 부산 3m warm | 0.73s / 0.74s | 동일 |

판매 6,631(00:49) vs 6,630(00:54 이후) 1건 차이: 두 응답의 DB 행 수(매매 34,314 / 전월세 52,148)는 같다. 현재월 MOLIT 응답 차이로 보이지만 요청별 원본을 남기지 않아 **원인은 확인하지 않았다**.

### 11.1 표본 구(단일 구 경로 — 변경 없음, MOLIT 24)

| 구 | cold | warm | 판매 / 갭 / 비율 | partial |
|---|---|---|---|---|
| 서구 26140 | 2.50s | 0.28s | 205 / 95 / 46.3% | false |
| 기장군 26710 | 2.24s | 0.21s | 350 / 261 / 74.6% | false |
| 해운대구 26350 | 3.00s | 0.27s | 826 / 633 / 76.6% | false |
| 강서구 26440 | 2.68s | 0.26s | 331 / 275 / 83.1% | false |

### 11.2 상세 조회 기아(starvation) 회귀

부산 전체 TTL 만료 cold 시작 1초 뒤 `/api/apt/대신롯데캐슬?aptSeq=26140-1164&type=rent&period=60`:
**7.75s, HTTP 200, 60/60 월 성공, partial false, 132건** (재요청 0.15s).
직전 감사 기준: 384 호출 gap cold 중 7.88s, 단독 5.63s. 같은 시각 gap cold가 7.01s로 단독(5.09s)보다 길었던 것은
gap의 bulk 32건이 상세의 interactive 60건에 슬롯을 양보했기 때문으로 우선순위 lane(`8c3d0c5`) 설계와 일치한다.
두 요청이 같은 인스턴스였는지는 응답으로 확인할 수 없어 "일치하는 결과"로 기록한다.

### 11.3 목표 대비

| 목표 | 결과 |
|---|---|
| cold < 5s (preferred) | 5.09s / 5.35s — **0.1~0.35s 미달** |
| cold < 8s (acceptable) | 5.09~7.01s — **달성** |
| warm < 1s | 0.70~0.99s — **달성** |
| 반복 > 10s FAIL / 30s+ 제거 | 최대 7.01s — **제거** (기존 34.18s / 37.74s) |

## 12. 알려진 한계

- DB-first 결과는 DB 데이터 품질을 그대로 물려받는다: 매매 과다취소 래칫(창 안 16행), 회수/정정 행 잔존
  (9행), 전월세 bootstrap 이후 원천 증가분 미반영(122행). 부산 전체 집계 영향 ≤0.2%(3m 기본 기준 갭 −8건),
  지역 순위 순서 불변. 수정은 cancellation ratchet repair / RENT RECHECK SWEEP(post-launch) 범위 — 이번
  STEP은 write/backfill 금지.
- 전월세 bootstrap 구간은 coverage 셀이 없어 "검증"이 과거 수집 증거에 의존한다. 이 경로는 피드·대시보드와
  같은 신뢰 기준을 쓴다(더 넓게 주장하지 않음).
- 단지 랭킹 동점 순서는 입력 순서에 의존한다(기존 경로도 동일). 정렬 규칙 변경은 결과 의미 변경이라 하지 않았다.
- 단일 구 경로(24 호출)는 여전히 MOLIT. 콜드 약 2~3초라 이번 blocker 범위 밖.
- `numOfRows=1000` 단일 페이지 — 창 안 최대 셀 896행이라 현재 영향 없음(기존 동작).

## 13. 다음 STEP 제안

- cancellation ratchet repair(취소 flip 되돌림 경로) — DB-first 통계 전체의 과소집계 제거
- RENT RECHECK SWEEP — 전월세 완료월 원천 증가분 반영 + bootstrap 구간 coverage 셀 기록
- 단일 구 gap-invest DB-first(같은 loader, lawdCds 1개) — 필요 시
