# STATISTICS PERFORMANCE V1

baseline: `88db077` (main)
날짜: 2026-08-28

## 1. Baseline

```
git branch --show-current -> main
git rev-parse HEAD -> 88db0776ee9d3d5640109066a63843cad6105586
git rev-parse origin/main -> 88db0776ee9d3d5640109066a63843cad6105586 (일치)
```

pre-existing dirty worktree(건드리지 않음): `package.json`, `package-lock.json`,
`ApartmentAutocomplete.tsx.bak`, `my_prod.html`, `prisma/schema_old.prisma`, `tmp/`.

## 2.감사한 라우트

`/api/stats/{dashboard(=volume), concentration, feed, price-rankings, rankings, yearly}`.
공통 계약(SIDO_ALL, `partial`/`failedDistricts`, dedupeTrades, 취소거래 제외,
bounded 2년최고가 라벨)은 이번 STEP에서 전혀 바꾸지 않았다 — 오직 fetch/캐시/
정렬 경로만 손댔다.

## 3. Call Counts (분석적 계산, 실제 구/월 수 기준 검증)

REGCODE_PROXY 실측: 부산 16개 구, 서울 25개 구(§4 아래).

| 라우트 | 조건 | task 수 계산 | 부산 | 서울 |
|---|---|---|---|---|
| dashboard(volume) SIDO_ALL | 12개월 × (apt+rent) | districts × 12 × 2 | 384 | 600 |
| concentration SIDO_ALL | preset 기간(30d ≈ 2~3개월) × 1 dealType | districts × ~3 × 1 | ~48 | ~75 |
| feed SIDO_ALL | preset 기간(sido-all은 12개월 lookback 안 붙임) × (apt+rent) | districts × ~2 × 2 | ~64 | ~100 |
| price-rankings SIDO_ALL | `HISTORICAL_LOOKBACK_MONTHS=24` × apt만 | districts × 24 × 1 | 384 | 600 |
| rankings SIDO_ALL | `months` 파라미터(기본 12) × 1 type | districts × 12 × 1 | 192 | 300 |

dashboard/price-rankings가 가장 많은 upstream 호출을 발생시키는 두 라우트라는
사전 가설이 실측 cold 타이밍(§17)과 일치했다.

## 4. Bottleneck Profile

- **A. region resolve**: `resolveLawdCd`/`getSigunguListForSido`가 이미
  모듈 레벨 `Map` 캐시를 갖고 있음(재기동 전까지 유지) — 이번 STEP에서 병목
  아님, 손대지 않음.
- **B. MOLIT fetch**: 압도적 1순위 병목. `GLOBAL_MOLIT_CONCURRENCY=3`(모든
  stats 라우트가 공유하는 전역 세마포어) + 슬롯당 최소 200ms 페이싱이 실질
  상한이었다.
- **C. JSON parse / D. dedupe / E. filtering**: MOLIT 호출 수 대비 무시할
  수준(개별 트레일링 로그로 확인, 수 ms).
- **F. aggregation**: dashboard/concentration/feed/rankings는 무시할 수준.
  **price-rankings만 예외** — cache-hit(warm) 상태에서도 2.4~5.9초가 걸렸다
  (§8 참고, 실제 원인은 CPU 정렬이 아니라 "페이지네이션 전 전체 후보에 대해
  Unit Master batch 쿼리"였다).
- **G. Unit Master resolve**: `resolveTrustworthyPyeongBatch`/
  `resolveApartmentContextBatch` 둘 다 이미 고정 2-query batch 패턴(N+1 아님,
  §19/§20 원칙 그대로 유지) — 문제는 쿼리 횟수가 아니라 **배치 크기**였다.
- **H. response serialize**: 무시할 수준.

## 5. Fetch Architecture — Before

- `getOrSetCache`(server-cache.ts)는 key당 TTL 캐시만 있고 in-flight dedupe가
  없었다 — 같은 cold key로 동시에 두 요청이 들어오면 MOLIT fetch storm이 그대로
  두 배가 될 수 있었다(§7 위험, 실측으로 재현하지는 않았지만 코드상 명백).
- `GLOBAL_MOLIT_CONCURRENCY = 3`(molit-stats-helpers.ts) — 모든 stats 라우트가
  공유하는 전역 세마포어. 슬롯 획득 후 최소 200ms 보유(`fetchMonthGated`).
- price-rankings route: `rows`(mode별 전체 후보, sido-all에서는 수백~천 건)를
  **정렬/페이지네이션 이전에** 전부 Unit Master batch 조회에 넣고 있었다 —
  dashboard/concentration/feed는 이미 top-N을 자른 뒤에만 batch 조회를 하는데
  price-rankings만 이 패턴에서 벗어나 있었다(실측: 부산 decline 모드 후보
  959건, 응답에 노출되는 건 30건뿐).

## 6. Fetch Architecture — After

- `getOrSetCache`에 in-flight `Promise` dedupe 추가(`inFlight: Map<string,
  Promise<unknown>>`). 캐시 키/TTL 의미는 전혀 바뀌지 않는다 — 성공/실패 모두
  `finally`에서 in-flight 항목을 제거해 메모리 누수/영구 실패 캐싱을 막는다.
- `GLOBAL_MOLIT_CONCURRENCY`를 3 → 6으로 상향(§8 권장 범위 4~8 안에서 선택).
  슬롯당 200ms 페이싱은 그대로 유지 — 순간 최대 요청 수만 6개로 늘어난다.
- price-rankings route: 정렬(`rows.sort`)과 페이지네이션(`rows.slice(offset,
  offset+limit)`)을 먼저 끝내고, Unit Master batch 조회/interpretation/
  sigunguName 계산은 **페이지에 실제로 노출되는 행(최대 limit=100)에만**
  수행하도록 순서를 바꿨다. 정렬 키(declinePct/riseAmount 등)는 pyung과
  무관하게 이미 row 안에 있으므로 정렬 순서·최종 응답 값은 완전히 동일하다
  (§21 unit master 원칙 유지, 배치 크기만 축소).

## 7. Concurrency

- 3 → 6 (권장 범위 4~8 안). §31 요구대로 부산/서울 SIDO_ALL cold를 반복
  실행해 `partial`/`failedDistricts` 증가 여부를 관찰했다 — before/after 전
  케이스에서 `partial=false`, `failedDistricts=0`(§17/§18 표 참고). 스로틀링
  징후 없음을 확인한 뒤 6으로 확정했다.
- 8까지 더 올리는 실험은 진행하지 않았다(§32 "보수적으로" 원칙 — 과거
  "초당 서비스 요청제한 횟수 초과" 에러 이력이 있는 API라 한 단계씩만 검증).

## 8. In-flight Dedupe

`server-cache.ts`의 `getOrSetCache`에 key별 in-flight Promise 공유 추가.
동시에 같은 cold cacheKey로 여러 요청이 들어와도 fetcher()는 1회만 실행된다.
완료(성공/실패) 즉시 in-flight map에서 제거 — 메모리 누수 없음, "실패 응답
영구 캐싱" 없음(실패는 store에 기록되지 않으므로 다음 요청이 다시 시도).

## 9. Cache

기존 5분 TTL 관례를 그대로 유지했다(§22 — 임의로 늘리지 않음). cache key
구조(§21 정확성 요구사항)도 변경 없음 — lawdCd/sidoCode, month/range,
dealType이 다르면 여전히 다른 키. 실측으로 TTL이 실제로 동작함을 확인했다
(부산 volume 캐시가 두 번째 배치 실행 시점에 5분을 넘겨 자동으로 다시
cold-fetch되는 것을 관찰, §17 참고).

## 10. Range Minimization

- dashboard(volume)는 12개월 전체가 실제로 차트/핫이슈/갭투자/전세가율에
  쓰이므로 축소하지 않았다(§11 지시 그대로 — 차트가 필요로 하면 유지).
- feed/concentration은 이미 preset 기간(7d/30d/3m 등)만큼만 fetch하고 있었다
  (기존 구현이 이미 최소 범위 원칙을 지키고 있었음 — 이번 STEP에서 추가로
  줄일 여지 없음).
- price-rankings의 24개월 lookback은 `HISTORICAL_LOOKBACK_MONTHS`로 이미
  의도적으로 고정된 값(코드 주석: 영구 저장 실거래 이력 DB 없이는 더 늘릴
  수 없고, 이 STEP 범위에서 줄이면 "역대 최고가" 정의 자체가 깨짐) — 손대지
  않음.

## 11. Volume Optimization

우선순위 1(부산 47s / 서울 103s cold)이었다. 12개월 × district × 2 type
구조 자체는 유지하되(§13 지시대로 차트가 12개월을 필요로 함), 동시성 3→6 +
in-flight dedupe만 적용. chartDataByType/hotIssues/gapInvest/jeonseRate/
volumeRanking 모두 이미 fetch 한 번의 결과(aptMonthly/rentMonthly)를
재사용하고 있었다(중복 fetch 없음, 기존 구현이 이미 §13 요구를 만족).

## 12. Concentration Optimization

이미 day-precise fetchRange(preset 기간만, 12개월 lookback 없음)로 범위가
좁아 cold 5~7초 수준이었다(§14 목표 10초 이내를 이미 만족). 동시성 상향으로
추가 개선(busan 4.9s→3.6s, seoul 7.3s→5.9s).

## 13. Feed Regression

feed(단일 구, lawdCd 기준)는 cold 2.2~5.6s, warm 8~163ms로 최적화 전후 모두
빠르고 회귀 없음(§16 요구사항 충족 — 오히려 소폭 개선). feed(SIDO_ALL)도
busan 6.0s→4.4s, seoul 12.7s→12.7s(변화 없음, district 수 대비 task 수가
작아 동시성 상향의 이득이 크지 않았을 뿐 — 저하 없음).

## 14. Price Ranking Impact

§15 지시대로 동일 fetch layer 개선(동시성)이 자연스럽게 적용됐고, 추가로
§6의 batch 크기 축소를 적용했다. 결과: cold busan 38.4s→28.6s, seoul
72.6s→53.1s; **warm**(cache-hit이지만 이전에는 여전히 2.4~5.9초였던 것)이
busan 2.8s→1.9s(§32 목표 ≤2s 달성), seoul 5.3~5.9s→4.1~4.2s(목표 미달,
§19 Known Limits 참고). 24개월 bounded 정의·하락/2년최고가/상승 계산 로직은
전혀 변경하지 않았다(응답 값이 최적화 전후 동일함을 §16 스팟체크로 확인).

## 15. Partial Failure

`partial`/`failedDistricts` 계약 완전히 유지. 동시성 상향 이후에도 모든
before/after 케이스에서 `partial=false`, `failedDistricts=0`(§17/§18).
`fetchMonthWithRetry`(1회 재시도, 400ms backoff)와 `fetchMonthGated`(슬롯당
200ms 페이싱)는 변경하지 않았다.

## 16. Cold Method

**진짜 cold**를 만들기 위해 브라우저 새로고침이 아니라 **dev 서버 프로세스
자체를 재시작**했다(§34 지시대로 — 모든 in-memory 캐시: `getOrSetCache` store,
`lawdCdCache`, `sigunguListCache가 초기화됨). 추가로 `.next/cache`를 삭제해
Next Data Cache까지 비웠다(로컬 dev 빌드 캐시 삭제 — production 파괴적
동작 아님). 재시작 직후 `scripts/run-statistics-performance-qa.ts --mode=cold`
를 1회 실행해 각 케이스를 정확히 1번만 호출했다.

## 17. Before/After Timings (Cold, SIDO_ALL)

| 케이스 | Before | After | 개선 |
|---|---|---|---|
| volume 부산 | 47.3s | 30.3s | -36% |
| volume 서울 | 103.1s | 79.5s | -23% |
| concentration 부산 | 4.9s | 3.6s | -27% |
| concentration 서울 | 7.3s | 5.9s | -19% |
| feed(SIDO_ALL) 부산 | 6.0s | 4.4s | -27% |
| feed(SIDO_ALL) 서울 | 12.7s | 12.7s | 0% |
| price-rankings 부산 | 38.4s | 28.6s | -25% |
| price-rankings 서울 | 72.6s | 53.1s | -27% |

Warm(연속 2회 호출, 두 번째 값 — §35):

| 케이스 | Before(2nd) | After(2nd) |
|---|---|---|
| volume 부산/서울 | 30ms / 19ms | 34ms / 26ms |
| concentration 부산/서울 | 106ms / 92ms | 102ms / 60ms |
| feed(SIDO_ALL) 부산/서울 | 84ms / 312ms | 84ms / 461ms |
| price-rankings 부산/서울 | 2375ms / 5955ms | **1810ms** / 4122ms |

district(단일 구) cold/warm — feed 회귀 확인용:

| 케이스 | Before cold→warm | After cold→warm |
|---|---|---|
| volume 부산 서구 | 2172ms→19ms | 1230ms→16ms |
| feed 부산 서구 | 2400ms→40ms | 1307ms→51ms |
| volume 부산 연제구 | 2860ms→18ms | 2138ms→14ms |
| feed 부산 연제구 | 3571ms→99ms | 2344ms→79ms |
| volume 서울 강남구 | 5172ms→19ms | 4540ms→20ms |
| feed 서울 강남구 | 5616ms→163ms | 4962ms→163ms |

원본 결과: `tmp/qa/STATISTICS_PERFORMANCE_V1_{before,after}_{cold,warm}.json`.

## 18. Request Counts

분석적 모델(§3)은 최적화 전후 동일하다 — **동시성/dedupe 최적화는 총 upstream
호출 수(task 개수)를 줄이지 않는다.** 줄어든 것은 "같은 task를 처리하는 데
걸리는 총 시간"(동시성 상향)과 "동시 cold 요청이 겹칠 때의 중복 실행"
(in-flight dedupe, 코드상 방지되지만 이번 실측 시나리오에서는 순차 실행이라
직접 재현/측정하지 않음)이다. UPSTREAM_CALL_REDUCTION은 이런 이유로 아래
FINAL REPORT에 NONE으로 기록한다(동시성 개선과 별개 항목).

## 19. Known Limits

- price-rankings 서울 warm이 여전히 목표(≤2s)를 넘는다(4.1~4.2s). 원인은
  bounded 배치 크기 축소 이후에도 남아있는 순수 JS 비용 — 캐시에는 raw MOLIT
  거래(서울 24개월×25구 규모, 수만 건)만 저장되고, `buildHistory`(그룹화+
  정렬)와 `buildDeclineRows` 등은 매 요청마다 그 원본 전체를 다시 훑는다.
  계산된 rows 자체를 캐싱하려면 mode/period/sort까지 포함한 새로운 캐시
  키 체계가 필요해 이번 STEP 범위(§24 "이번 STEP은 DB-backed 캐시를 만들지
  않는다"와는 별개로, in-memory라도 캐시 아키텍처 확장이라 범위 확대) 밖으로
  판단해 보류했다. NEXT_STEP 후보로 남긴다.
- MOLIT 외부 API 자체의 네트워크 지연이 여전히 cold 시간의 대부분을
  차지한다(volume 서울은 여전히 79.5s) — concurrency를 8까지 더 올리면
  이론상 추가 개선 여지가 있지만, 이번 STEP에서는 "초당 요청제한" 이력이
  있는 API라 한 단계(3→6)만 검증했다. 다음 STEP에서 8까지 안전하게 올릴 수
  있는지 별도로 측정해볼 수 있다.
- 목표 미달 항목: volume 부산(목표 ≤12s/가능하면 ≤8s, 실측 30.3s),
  volume 서울(목표 ≤20s/가능하면 ≤15s, 실측 79.5s), price-rankings 서울
  warm(목표 ≤2s, 실측 4.1s). 모두 위 두 원인(외부 API 네트워크 지연 상한,
  캐시되지 않는 CPU 재계산) 때문이며, 영구 저장 캐시/이력 DB 없이는 이
  STEP의 아키텍처 안에서 더 줄이기 어렵다고 판단한다.

## 20. DB Persistence Future

이번 STEP은 DB-backed trade history/cache를 만들지 않았다(TRUE GATE 대상,
범위 밖). §19에서 확인한 잔여 병목(외부 API 상한, 반복 CPU 재계산) 둘 다
영구 저장소가 있으면 근본적으로 해결 가능하다 — 다음 STEP 후보로 문서화한다.

## 21. Next Step

`DB_CACHE_GATE` 권장: 실거래 원본을 (lawdCd, dealYmd, dealType) 단위로
영구 저장하는 캐시 테이블을 만들면 (a) cold 시간이 "MOLIT 재조회"가 아니라
"DB 조회"로 바뀌어 수십 초 → 수백 ms 수준으로 떨어질 잠재력이 있고,
(b) price-rankings 같은 CPU 재계산 비용도 사전 계산/증분 갱신으로 옮길 수
있다. 단, 이는 스키마 변경 + migration이 필요한 TRUE GATE 항목이라 사용자
승인 없이는 진행하지 않는다.
