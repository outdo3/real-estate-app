# E-JIP MOLIT PARTIAL FAILURE REDUCTION V1

PRE-LAUNCH / EARLY-OPS P1 · RATE-LIMIT / RETRY / THROTTLE AUDIT + SAFE FIX

기준 커밋: `1203331` (main). 릴리스 freeze(`e867a40` RC) 기간의 P1 수정이다.

## 1. 목적

`/admin/system`에 반복해서 올라오는 `MOLIT_PARTIAL`(요청한 월 중 일부만 성공)을 줄인다.
"더 빠르게"가 아니라 **부분 실패 자체를 줄이고, 실패해도 안전하게 끝나게** 하는 것이 목표다.
로그를 숨기거나 TTL을 늘리는 방식은 쓰지 않았다.

## 2. 현재 상태 (수정 전)

### 2.1 운영 로그 (error_logs, READ ONLY, 2026-09-13 기준)

`scripts/audit-molit-partial-logs.ts` — write 0, 외부 호출 0.

| 창 | MOLIT_PARTIAL | 요청 월 | 실패 월 | 실패율 |
|---|---:|---:|---:|---:|
| 최근 1시간 | 0 | – | – | – |
| 최근 24시간 | 0 | – | – | – |
| 최근 7일 | **97** | 4,440 | 1,721 | **38.8%** |

최근 7일 분포:

- route: `/api/apt/[name]` **97 / 97 (100%)**. 통계/거래목록/학교/분양 라우트는 0건.
- 사유: `초당 서비스 요청제한 횟수 초과` **91 (93.8%)**, timeout 6.
- type: apt 65, rent 32.
- period: 60 → 49, 36 → 34, 12 → 13, 120 → 1.
- lawdCd 상위: 26500(수영구) 24, 26440(강서구) 16, 26140(서구) 15, 26410(금정구) 13, 26350(해운대구) 12, 11680(강남구) 2.
- 실패 비율 구간: 20~50% 43건, 50~90% 22건, ≥90% 7건, 5~20% 8건, <5% 17건.
- 같은 7일 동안 error_logs 전체 97건 = MOLIT_PARTIAL 97건. 다른 서버 오류는 없었다.

대표 샘플(요약): `type=apt lawdCd=11680 period=60 ok=15 failed=45`,
그 1.6초 전 같은 지역 `ok=24 failed=36` — 상세페이지 한 번에 같은 라우트가 동시에 여러 번 호출된 흔적.

### 2.2 호출 경로 (실제 코드 기준)

MOLIT 실거래(RTMS) HTTP는 두 곳에서만 나간다.

```
fetchMolitData (src/lib/api-molit.ts)                ← 라이브 트래픽 전부
 ├─ molit-month-cache.fetchMolitMonthCached          (TTL 1h + in-flight dedup, 실패 월 미캐시)
 │   ├─ /api/apt/[name]                              chunk 12개월 × Promise.all   ◀ 게이트 없음
 │   └─ /api/presales/[id]/nearby-market             Promise.all                  ◀ 게이트 없음
 ├─ molit-stats-helpers.fetchMonthGated              동시성 6 / 200ms / 400ms 1회 재시도
 │   └─ /api/stats/{dashboard,feed,rankings,yearly,gap-invest,concentration,price-rankings,region-change,large-complex}
 ├─ /api/transactions                                months.map 동시            ◀ 게이트 없음
 ├─ /api/school/apartments, /api/school/[id]         months.map 동시            ◀ 게이트 없음
 ├─ /api/stats/* 의 최신월 probe 1건                  단건                        ◀ 게이트 없음
 ├─ /api/admin/dashboard                             단건
 ├─ apartment-score/collectors/market.ts             단건 반복
 └─ services/publicDataService.ts (officetel)        단건

scripts/sale-molit-fetch.ts (fetchSaleRegionMonth)   ← Cron sale sync 전용, 자체 fetcher
 └─ src/lib/sync/sale-sync-core.ts                   lawdCd × month **순차** for 루프
```

감사 항목별:

| 항목 | 수정 전 |
|---|---|
| 전역 throttle 위치 | `molit-stats-helpers.ts` 모듈 레벨 — **통계 라우트만** 통과 |
| concurrency | 통계 6 / 상세 12(청크) / 거래목록·학교 제한 없음 |
| pacing | 통계 슬롯당 200ms / 나머지 0 |
| retry | 통계: 모든 실패 400ms 뒤 1회 / 나머지 0 |
| exponential backoff · jitter | 없음 |
| 429/제한 식별 | 없음(통계 재시도는 원인 구분 없음) |
| timeout | fetch당 `AbortSignal.timeout(5000)` |
| pagination | `numOfRows=1000` 1페이지(라이브). sync는 전 페이지 |
| 중복 호출 | 상세페이지 1회 = 이 라우트 3회(parent + 차트/지표) |
| cache/dedup | 상세·분양: 월 TTL 1h + in-flight dedup / 통계: 라우트 단위 캐시만 |
| partial 반환 | `partial` / `failedMonths` / `apiError`(전 월 실패) / `[MOLIT_PARTIAL]` 로그 |
| 인스턴스 범위 | 전부 in-process(서버리스 인스턴스 로컬) |

## 3. 분석

### 3.1 수정 전 실측 (MOLIT 실제 호출, DB 0)

`scripts/audit-molit-throttle-probe.ts`. 상세 라우트 구조(12개월 청크 동시, 페이싱·재시도 없음)를 그대로 재현.

| 케이스 | ok | failed | 실패율 | 시간 |
|---|---:|---:|---:|---:|
| A 부산 서구 60m | 56 | 4 | 6.7% | 1.1s |
| B 부산 기장군 60m (3초 뒤) | 0 | 60 | 100% | 0.2s |
| C 서울 강남구 60m (3초 뒤) | 0 | 60 | 100% | 0.2s |

같은 60개월을 게이트를 두고 보내면(단일 인스턴스, 재시도 없음):

| 동시성 / 페이싱 | 실패율 | 60개월 시간 |
|---|---:|---:|
| 6 / 200ms | 0% | 3.3s |
| 4 / 250ms | 0% | 5.6s |
| 3 / 300ms | 0% | 8.5s |
| 2 / 350ms | 0% | 14.3s |

60개월 3건 동시(180콜)를 공유 게이트 6/200 하나로: **0/180 실패, 12.4s**.

### 3.2 프로바이더 동작 — 한 번 넘기면 키가 약 60초 잠긴다

60콜 버스트로 제한을 건 뒤 1초 간격 단일 요청:
`1.1s RL … 58.6s RL, 59.7s OK, 60.8s OK …` → **첫 성공 59.7s**.

- 초당 제한이 아니라 **잠금 창**이다. 잠긴 동안의 재시도는 성공할 수 없다.
- 1초 간격 단일 요청은 잠금을 늘리지 않았다.
- 잠금은 서비스 키 단위다(다른 지역 코드도 함께 막힘). 키는 모든 인스턴스가 공유한다.

이 때문에 과제 문서가 예시로 든 `500~800 / 1000~1600 / 2000~3200ms` backoff만으로는
잠금을 넘길 수 없다. 실측으로 확인했다: 다른 인스턴스의 무게이트 버스트와 충돌한 상태에서
"backoff 재시도만 있는" 1차 구현은 **재시도 171회, 53.2s, 95% 실패**였다.

### 3.3 다중 인스턴스 합산

| 동시에 뜨거운 인스턴스 × 설정 | 결과 |
|---|---|
| 2 × 6/200 | **83~84% 제한** |
| 2 × 4/250 (각 ~11 rps) | 0% |
| 3 × 4/250 (합산 ~33 rps) | 93% 제한 |
| 2 × 3/300 (각 ~7.5 rps) | 0% |

→ 키 한도는 합산 약 22~33 rps 사이.

### 3.4 원인 분류

| 패턴 | 판정 | 근거 |
|---|---|---|
| A. burst성 | **주원인** | 상세 라우트가 12개월을 게이트 없이 한꺼번에. B/C 100% 실패 재현 |
| B. long-range | **증폭** | 로그 period=60이 49/97. 콜드 월 수가 곧 버스트 크기 |
| C. 동시 사용자 충돌 | **증폭** | 상세페이지 1회 = 3회 동시 호출(1.6초 간격 쌍 로그) |
| D. retry storm | 잠재 | 상세 경로엔 재시도가 없었다. 단, 잠금 중 재시도는 storm이 된다(§3.2) |
| E. 서버리스 다중 인스턴스 | **잔여 위험** | 2×6/200 → 84% 제한. 게이트가 인스턴스 로컬 |
| F. cron + 사용자 겹침 | 낮음 | sale sync는 lawdCd×월 순차 1건씩 |

통계와 상세의 두 풀이 **서로를 모른 채 합산**되는 구조가 근본 원인이다.

## 4. 설계 결정

1. **게이트를 `fetchMolitData` 한 곳으로 옮긴다.** 라이브 트래픽의 모든 MOLIT 호출이 같은
   세마포어를 지난다. 통계 헬퍼의 자체 풀/재시도는 제거한다(남기면 페이싱 이중 + 재시도 곱).
2. **인스턴스당 4 / 250ms.** 단일 인스턴스는 6/200도 안전했지만 인스턴스 2개에서 키가 잠긴다.
   4/250은 2개까지 0%, 60개월 콜드 조회 3.3s → 5.6s.
3. **재시도는 `초당 요청제한`에만.** timeout/인증/잘못된 요청/파싱 실패/정상 0건은 재시도하지
   않는다. 일일 한도(`…_EXCEEDS_ERROR`, "초당" 없음)도 재시도하지 않는다.
4. **차단기(circuit breaker).** 잠금은 60초이므로 요청마다 따로 두드리지 않는다.
   - 제한을 맞으면 5초 동안 이 인스턴스의 MOLIT 호출을 멈추고, 이후 probe 1건만(half-open).
   - 제한 이전에 출발한 요청의 뒤늦은 성공으로는 닫지 않는다.
   - 대기는 요청당 8초 예산. 추가로 **잠금 구간 기준** 예산 — 확인된 잠금이 이미 8초를
     넘겼으면 새 요청은 기다리지 않고 바로 실패(청크마다 8초씩 다시 기다리지 않게).
   - 조용한 기간 뒤(마지막 제한 확인이 오래됨)에는 새 구간으로 보고 다시 probe 결과를 기다린다.
   - 호출 없이 끝난 실패의 사유: `초당 서비스 요청제한 횟수 초과 에러 — 제한 해제 대기 중이라
     요청을 보내지 않음`. 원 응답을 받은 경우는 원문 그대로.
5. **backoff + jitter는 재시도 사이 최소 대기로 유지.** 500~800 / 1000~1600 / 2000~3200ms,
   구간이 겹치지 않아 jitter가 순서를 뒤집지 못한다. 최대 4회 시도.
6. **적응형 쿨다운.** 제한 후 잠금 해제 + 10초 동안 슬롯 간격 +200ms씩(상한 +800ms).
   성공 20회마다 한 단계 복귀, 창이 지나면 기본값.
7. **in-flight dedup을 `fetchMolitData`에도.** 같은 (유형, lawdCd, 월)이 진행 중이면 네트워크 1회.
   결과를 저장하지 않으므로 신선도 정책 무변경. 대기자마다 배열+item 얕은 복사본을 준다
   (item은 평평한 원시값 객체 — 통계 호출부의 in-place 정렬이 서로 새지 않게).
8. **DB-first로 MOLIT 호출 줄이기는 이번 STEP에서 하지 않는다(§8).** 아래 §9.3.

### 게이트를 쓰지 않은 대안

- 동시성만 낮추기: 다중 인스턴스 합산을 못 막고, 잠금이 걸린 뒤의 storm도 그대로다.
- TTL 늘리기: 콜드 요청의 실패율은 그대로이고 실패를 오래 가린다(과제 §13 금지).
- Redis/KV 전역 limiter: 외부 인프라 추가 — 승인 필요(§18 STOP 조건).

## 5. 구현 내용

| 파일 | 변경 |
|---|---|
| `src/lib/molit-rate-guard.ts` (신규) | 실패 분류, 게이트 4/250, 차단기, backoff+jitter, 적응형 쿨다운, in-flight dedup |
| `src/lib/api-molit.ts` | HTTP 1회 시도를 `fetchMolitDataOnce`로 분리하고 `fetchMolitData` = dedup(guard(once)). URL·timeout·파서·빈 결과·플레이스홀더·마스킹 규칙 무변경 |
| `src/lib/molit-stats-helpers.ts` | 자체 세마포어/페이싱/재시도 제거 → `fetchMolitData` 단일 호출. `failed` 판정/반환 shape 무변경 |
| `src/app/api/apt/[name]/route.ts` | 주석만(청크는 이제 큐 길이만 정한다) |
| `src/lib/molit-rate-guard.test.ts` (신규) | 22 tests |
| `src/lib/stats/feed-db-source.test.ts` | 스로틀 회귀 가드를 새 위치로. 의도(동시성을 올리지 않는다, 단일 전역 세마포어)는 유지 — 6 초과면 여전히 실패 |
| `scripts/audit-molit-partial-logs.ts` (신규) | error_logs READ ONLY 분포 감사 |
| `scripts/audit-molit-throttle-probe.ts` (신규) | MOLIT 실측 probe(baseline/gated/burst/after/after-burst/multi/collision/penalty). DB 접근 없음 |

바뀌지 않은 것: 월 캐시 키/TTL, `partial`/`failedMonths`/`apiError`/`monthsRequested`/`monthsSucceeded`
의미, `[MOLIT_PARTIAL]` 로그 조건과 형식, 취소 거래 규칙, period 옵션, Cron sync, 통계 공식.

## 6. 테스트 결과

### 6.1 수정 후 실측 (같은 probe, 최종 코드)

| 시나리오 | 수정 전 | 수정 후 |
|---|---|---|
| A 부산 서구 60m | 4/60 실패(6.7%), 1.1s | **0/60**, 5.6~5.8s |
| B 부산 기장군 60m | 60/60 실패(100%), 0.2s | **0/60**, 6.2~6.6s |
| C 서울 강남구 60m | 60/60 실패(100%), 0.2s | **0/60**, 6.8~7.5s |
| 60m 3건 동시(180콜), 단일 인스턴스 | (게이트 없음 구조상 대량 실패) | **0/180**, 17.0~17.5s, 재시도 0 |
| 인스턴스 2개 × 60m 3건 동시(360콜) | 6/200 공유 게이트로도 74~77% 실패 | **0/360**, 각 17.3~17.8s, 재시도 0 |
| 다른 인스턴스 무게이트 버스트와 충돌(C 60m) | backoff만: 57/60 실패, **53.2s**, outbound 231, 재시도 171 | 58/60 실패(키 잠김, 회복 불가), **10.6s**, outbound **13** |

- outbound 콜 = 월 수(재시도 0) — 정상 경로에서는 제한 응답이 한 번도 나오지 않았다.
- 충돌 시나리오의 실패는 다른 주체가 키를 60초 잠근 결과다. 이 인스턴스가 할 수 있는 것은
  잠긴 키를 두드리지 않고 빨리 정직하게 실패하는 것뿐이다 — outbound 94% 감소, 시간 80% 감소.
- 부분 실패 목표(60개월, preferred < 2%): 정상·2인스턴스 시나리오 0%.

### 6.2 지연 영향

단일 60개월 콜드 조회 3.3s(6/200) → 5.6~7.5s(4/250). 수정 전 운영의 같은 조회는 대부분 부분 실패였다.
캐시가 찬 월은 네트워크를 타지 않으므로 반복 조회는 영향이 없다. 상세페이지의 세 호출은 같은
lawdCd라 월 캐시/in-flight dedup으로 한 번의 스윕에 합쳐진다.

### 6.3 자동 테스트

- `npx tsx --test src/lib/molit-rate-guard.test.ts` → **22/22 pass**
- `npx tsx --test src/lib/stats/feed-db-source.test.ts` → 18/18 pass
- src 전체 `npx tsx --test` → **1737/1737 pass** (기존 1715 + 신규 22)
- `npx tsc --noEmit` → `FAIL_EXISTING_SCRIPT_ERRORS`: 25 errors 전부 `scripts/`·`tmp/`의 기존 파일, `src/` 0건, 이번 변경 파일 0건
- `npx eslint <변경 파일 8개>` → exit 0
- `npm run build` → exit 0

과제 §15 매핑: 1 제한 인식 · 2/6 제한만 재시도 · 3 bounded · 4 backoff 증가 · 5 jitter 범위 ·
7 성공 월 재호출 없음 · 8 실패 단위만 재시도 · 9 소진 후 partial 유지 · 10 in-flight dedup ·
11 동시성 상한 · 12 빈 월/취소 필드 · 13 apiError 의미 · 14 다른 월/지역 fallback 없음 ·
15 `[MOLIT_PARTIAL]` 로그 조건 유지 — 전부 테스트로 고정. 추가: 차단기 probe 1건, 호출 없는 실패,
뒤늦은 성공이 차단기를 닫지 않음, 대기 중 슬롯 반납, 잠금 구간 예산, 조용한 기간 뒤 재대기, 키 마스킹.

## 7. 데이터 신뢰 의미

- 제한으로 못 받은 월 = `FAILED`(플레이스홀더). 정상 0건 = `SUCCESS_EMPTY`. 섞지 않는다.
- 호출 없이 끝난 실패도 `FAILED` + 제한 사유. 성공으로 위장하지 않는다.
- 다른 월/다른 지역 데이터로 채우지 않는다(dedup 키에 유형·lawdCd·월 모두 포함).
- `partial`/`failedMonths`/`apiError`/`[MOLIT_PARTIAL]`는 기존 조건 그대로 — 이번 STEP은 로그를
  줄이는 게 아니라 실패를 줄였다.

## 8. 서버리스 한계

게이트·차단기·dedup은 **인스턴스(프로세스) 로컬**이다.

- 동시에 콜드 스윕을 도는 인스턴스가 3개 이상이면 합산이 키 한도를 넘을 수 있다(3×4/250 → 93% 제한 실측).
- 한 인스턴스가 연 차단기를 다른 인스턴스는 모른다. 각자 첫 제한 응답을 받고 연다.
- 잠금은 키 단위 60초라 어느 인스턴스가 걸어도 전부가 영향을 받는다.

전역 조율은 Redis/Vercel KV 같은 공유 저장소가 필요하다 — 승인 필요 항목으로 남긴다.

## 9. 알려진 문제 / 남은 위험

1. 위 §8 다중 인스턴스 합산.
2. timeout은 재시도하지 않는다(과제 정책). 이전에 통계 경로는 모든 실패를 1회 재시도했으므로
   **통계 경로의 timeout 1회 재시도는 사라졌다.** 7일 로그의 timeout은 6건, 전부 상세 라우트.
3. **DB-first 축소 보류.** `type=apt`는 DB-first로 응답할 때도 MOLIT 스윕을 먼저 전부 수행하고
   결과를 버린다(`usedDb`면 `partial=false`, `failedMonths=[]`). 그런데 응답의
   `monthsRequested`/`monthsSucceeded`는 MOLIT 기준 값이고, 클라이언트 `detail-trade-window.ts`가
   `monthsRequested === period`일 때만 좁은 창 완전성을 재계산한다. 스윕을 건너뛰려면 DB 응답에서
   이 두 필드가 무엇을 뜻하는지(DB 쿼리 완전성 vs 원천 coverage 완전성)를 먼저 정해야 한다 —
   진행 중인 APARTMENT_TRADE_SYNC_COVERAGE_AUDIT와 같은 질문이라 이번 STEP에서 결정하지 않았다.
   같은 이유로 DB로 응답한 요청의 `[MOLIT_PARTIAL]` 로그는 사용자가 완전한 DB 데이터를 봤는데도
   남는다(수정 전부터 있던 동작).
4. 적응형/차단기 상수(5s probe, 8s 예산, +200ms 단계)는 실측 1회 잠금(59.7s) 기준이다.
   프로바이더가 정책을 바꾸면 재측정이 필요하다.
5. `src/components/stats/RegionChangeMapView.tsx`, `scripts/rent-trade-history/rent-molit-fetch.ts`의
   주석이 옛 `GLOBAL_MOLIT_CONCURRENCY=6`을 언급한다(코드 영향 없음, 범위 밖이라 두었다).

## 10. 다음 STEP (승인 필요)

- 전역 limiter(Redis/Vercel KV) — 인스턴스 합산과 차단기 공유.
- 상세 `type=apt` DB-first 스윕 생략 — DB 응답의 `monthsRequested`/`monthsSucceeded` 의미 결정 후.
- 운영 배포 후 7일 `MOLIT_PARTIAL` 재집계(`scripts/audit-molit-partial-logs.ts`).
