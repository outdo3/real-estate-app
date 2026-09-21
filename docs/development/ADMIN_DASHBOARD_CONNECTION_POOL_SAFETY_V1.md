# E-JIP ADMIN DASHBOARD CONNECTION POOL SAFETY V1

`/api/admin/ops`에서 검증된 pool 안전 패턴을 `/api/admin/dashboard`에 적용한다.

- 감사·구현: 2026-09-21 · 기준 커밋 `6cfb20a` → `9e31f0a`
- **schema 0 · migration 0 · index 0 · env 0 · business data write 0**

## 판정

**PASS** — 운영 12/12 HTTP 200, P50 **261ms** / P95 **1,367ms**, degraded 0,
KST parity delta **0/0** 유지, 화면 정상 렌더.

---

## 1. Query graph

`Promise.all` 블록 **하나**, 항목 **15개**(DB 14 + 외부 HTTP 1).

| # | table | operation | 성격 | 단독 latency |
|---|---|---|---|---|
| 1 | `page_views` | count (오늘, 이벤트 제외) | today | 237ms |
| 2 | `page_views` | `$queryRaw` COUNT(DISTINCT session_id) | today | 45ms |
| 3 | `active_sessions` | count | realtime | 36ms |
| 4 | `active_sessions` | groupBy currentAptName take 10 | realtime | 33ms |
| 5 | `page_views` | groupBy aptName, 30일, take 10 | 30d | 46ms |
| 6 | `users` | count (오늘) | today | 68ms |
| 7 | `users` | count (전체) | total | 35ms |
| 8 | `search_logs` | groupBy query, 7일, take 10 | 7d | 44ms |
| 9 | `posts` | count (오늘) | today | 58ms |
| 10 | `comments` | count (오늘) | today | 52ms |
| 11 | `posts` | findMany take 10 (+author join) | recent | 75ms |
| 12 | `reports` | count (unresolved) | total | 48ms |
| 13 | `error_logs` | findMany take 20 | recent | 31ms |
| 14 | `page_views` | groupBy url, 7일, 이벤트 | 7d | 41ms |
| 15 | — | `checkPipelineHealth()` (MOLIT HTTP, 5분 캐시) | external | — |

테이블 크기: `page_views` **4,578행** · `active_sessions` 712 · `search_logs` 41 · `error_logs` 129.
**순차 합계 ≈ 650~850ms.**

## 2. 이전 동시성 — 그리고 내가 지난 STEP에서 과장했던 부분의 정정

이전 구조는 14개 DB 쿼리를 한 번의 `Promise.all`로 동시에 띄웠다. `/api/admin/ops`를
죽였던 바로 그 모양이다.

**다만 이 라우트만 놓고 보면 지금은 안전하다.** 실측:

| 조건 | 결과 |
|---|---|
| limit=1, pool_timeout=10s, `Promise.all(14)` | 650ms, **rejected 0/14** |
| limit=1, pool_timeout=**2s**, `Promise.all(14)` | 616ms, **rejected 0/14** |

ops가 터진 이유는 큐에 **6초어치 작업**이 쌓였기 때문인데, 여기는 큐가 650ms면 빠진다.

> 지난 STEP 보고에서 "대시보드도 같은 구조라 터지는 것은 시간 문제"라고 적었다.
> **구조가 같다는 것은 맞지만 위험도는 그때 말한 것보다 낮다.** 측정해보니 이 라우트
> 단독으로는 현재 여유가 크다. 정정해 둔다.

## 3. 진짜 위험 — 포트를 나눠 쓰는 다른 라우트

`prisma`는 싱글턴이라 **같은 인스턴스의 모든 라우트가 connection 하나를 공유**한다.
`/api/admin/ops`의 `busanCanceled`는 1.2~10초를 잡는다. 그쪽이 점유한 동안
여기서 `Promise.all`을 띄우면 14개의 `pool_timeout` 타이머가 **함께** 돌기 시작한다.

**재현 실측**(다른 쿼리가 3초 점유, `pool_timeout=2s`, 동일 14개 작업):

| 실행 방식 | latency | 거부 |
|---|---|---|
| `Promise.all` | 2,040ms | **14/14 rejected (전부 P2024)** |
| **순차** | 2,981ms | **1/14 rejected** (점유를 기다린 첫 개만) |

`Promise.all`은 외부 점유자가 14개의 예산을 **한꺼번에** 태운다. 순차는 자기 차례에
비로소 요청하므로 타이머가 새로 시작된다. 운영자가 관리자 탭을 오가고 대시보드가
20초마다 자동 갱신되는 환경에서 이 겹침은 실제로 일어난다.

> 디버깅 메모: 첫 재현 시도는 실패했다. `PrismaPromise`는 **lazy**라 `.then()`을 붙이기
> 전까지 실행되지 않는다 — 점유자를 만들었다고 생각했지만 아무것도 실행되지 않고 있었다.

## 4. 새 동시성 — ops 패턴 재사용

새 추상화를 만들지 않고 `src/lib/admin-ops-runner.ts`를 그대로 쓴다.

```ts
const m = <T,>(key, run) => isolate(key, run, noteMetricFailure);
const todayPageViewsM = await m('todayPageViews', () => prisma.pageView.count(...));
const todaySessionsM  = await m('todayVisitSessions', () => prisma.$queryRaw`...`);
…
```

**파이프라인 헬스는 순차 체인 밖에 둔다.** 외부 HTTP(MOLIT)라 DB connection을 잡지
않으므로, DB 체인 **전에 착수시키고 후에 거둔다** — 기존 병렬성을 그대로 유지하면서
pool에는 영향을 주지 않는다(테스트로 순서를 고정).

## 5. Cache 전략

| 지표 | 캐시 | 이유 |
|---|---|---|
| `popular30d` · `top-searches-7d` · `events-7d` | **60초** | 분 단위로 의미가 바뀌지 않는다 |
| **오늘 PV / 방문 세션 / 신규가입 / 글 / 댓글 / 실시간** | **없음** | 아래 |

**오늘 지표를 캐시하지 않는 것은 의도적이다.** `ADMIN_ANALYTICS_DATE_PARITY_FIX_V1 §9`에서
행동 분석의 `today`를 무캐시로 만들어 두 화면이 **같은 순간 delta 0**을 보게 했다.
여기에 캐시를 걸면 그 계약이 다시 깨진다(테스트로 고정).

7일/30일 캐시의 목적은 latency가 아니라 **connection 점유 시간 단축**이다 — pool=1에서는
그것이 같은 pool을 쓰는 다른 라우트에게 주는 가장 큰 도움이다.

**degraded TTL은 필요 없다.** ops는 *요약 전체*를 캐시해서 부분 실패가 TTL 내내 고정되는
문제가 있었지만, 여기는 **지표별로** 캐시한다. fetcher가 throw하면 `getOrSetCache`가
아무것도 저장하지 않으므로 실패는 애초에 캐시되지 않고 다음 요청이 바로 재시도한다.

## 6. 부분 실패 격리

- 지표마다 `isolate()` → 실패는 그 칸만 `UNKNOWN`
- **전부 실패했을 때만** `isTotalDbOutage()`로 전체 실패 처리(연결 자체 장애와 구분)
- `data.degradedMetrics`에 못 읽은 지표 이름 → 화면 상단 배너(ops와 같은 시각 언어)

## 7. 거짓 0 금지

| 예전 | 지금 |
|---|---|
| 조회 실패 → 라우트 500 | 숫자 `null` → 화면 **"확인 불가"** |
| 배열 실패 시 상상 불가(전체 500) | 배열 `null` → **"확인 불가 — 조회에 실패했습니다"** |

**배열을 빈 배열로 내리지 않는 것이 핵심이다.** `[]`는 "지금 보는 사람이 없습니다",
"아직 검색 기록이 없습니다"로 렌더된다 — 조회 실패를 **사실처럼** 보여주게 된다.
진짜 0과 확인 못 함은 다른 사실이다.

## 8. Error logging

`ADMIN_ERROR_LOGGING_P1` 유지 + category 추가:

| category | 의미 |
|---|---|
| `ADMIN_DASHBOARD_FAILURE` | 라우트 전체 실패(기존) |
| **`ADMIN_DASHBOARD_METRIC_FAILURE`** | **지표 한 조각 실패(신규, `metric=<key>`)** |

중복 억제 5분 유지, dedupe 키에 `metricKey` 포함, 민감정보 금지 그대로.

**기존 테스트 하나를 고쳤다.** `log-admin-failure.test.ts`의 "성공 경로에는 로깅이 없다"는
*파일 안에서 catch가 로깅보다 앞에 있는가*만 봤다. 이제 부분 실패를 `isolate`의 오류
콜백에서 기록하므로 그 검사는 너무 거칠다. **모든 호출이 오류 경로(catch / 실패 콜백 /
`.catch`) 안에 있고, 직전 성공 응답보다 그 진입점이 가깝다**는 실제 계약으로 바꿨고,
검사 대상에 ops 라우트도 추가했다.

## 9~11. 성능 / 운영 QA

**배포 후 관리자 세션으로 12회 연속 호출:**

| 항목 | 값 |
|---|---|
| HTTP status | **200 × 12/12** |
| 실패 | **0** |
| P2024 | **0** |
| **P50** | **261ms** |
| **P95** | **1,367ms** |
| min / max | 218ms / 1,367ms |
| degradedMetrics | 12회 전부 **0건** |

warm 목표(≤1.5s) 충족. 요약 캐시가 없으므로 이 수치는 **매번 14개 쿼리를 실제로 도는**
값이다(3개는 60초 캐시 적중). 218~507ms가 일반, 886·1,367ms는 콜드 인스턴스.

**`error_logs`:** 배포 후 `ADMIN_DASHBOARD*` 기록 **0건**.
`ADMIN_OPS_FAILURE`도 총 2건이고 **마지막이 07:43:54Z(ops 수정 배포 전)** 그대로다.

**화면 실측** — `/admin/dashboard` 전 섹션 정상:

| 카드 | 표시 |
|---|---|
| 트래픽 요약 | 오늘 방문 세션 **317** / PV **318** / 실시간 0명 / 신규가입 0·총 5 · "오늘 = 한국시간 00:00 기준 · 마지막 갱신 17:45" |
| 실시간 및 인기 아파트 | 누적 인기 TOP 10 정상(대신푸르지오 155회 …) |
| 인기 검색어 & 지역 관심도 | 빈 상태 안내(= 진짜 0건, `search_logs` 최신 행이 2026-09-12) |
| 커뮤니티 현황 | 0 / 0 / 0건 · 최근 작성글 표시 |
| 공공 API 파이프라인 | MOLIT **정상** · 청약홈 미연동 · 건축물대장 설정됨 |
| 시스템 에러 로그 | 20건 표시 |

degraded 배너 없음 = 모든 지표를 실제로 읽었다는 뜻이다.

## 12. KST regression (§9)

같은 순간 두 API 호출:

| 항목 | 대시보드 | 행동 분석 | delta |
|---|---|---|---|
| window | `2026-09-20T15:00:00.000Z` | `2026-09-20T15:00:00.000Z` | **동일** |
| 방문 세션 | **317** | **317** | **0** |
| 페이지뷰 | **318** | **318** | **0** |

`startOfKstDay` · `startOfKstDaysAgo(6/29)` · `todayStartsAt` · `fetchedAt` 전부 유지
(테스트로 고정, `setHours(0,0,0,0)` 재등장 금지 포함).

## 13. 테스트 (§8)

`src/lib/admin-ops-runner.test.ts`에 **7건 추가**(총 24건). 장애 주입은 전부 mock —
Production에 고의 장애를 주지 않았다.

| 시나리오 | 검증 |
|---|---|
| A. 한 지표 timeout | 전체 200 · 그 지표만 UNKNOWN · 값은 null(0 아님) |
| B. 여러 지표 실패 | 살아 있는 지표 유지 · `degradedMetrics`에 이름 노출 |
| C. DB 전체 불가 | `isTotalDbOutage`일 때만 전체 실패 |
| D. cache hit | 7일/30일 3개가 `SLOW_METRIC_TTL_MS`로 캐시 |
| 배선 | `Promise.all(prisma…)` 재등장 금지 · 14개가 하나씩 await · 외부 HTTP는 체인 밖 · 오늘 지표 무캐시 · KST 계약 · 거짓 0 금지 |

**src 전체 1,944 pass / 0 fail** · tsc src 0 · eslint 0 · `npm run build` ✓.

## 14~15. No-write assertion

| 항목 | 값 |
|---|---|
| business table INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| schema · migration · index · env | **0 · 0 · 0 · 0** |
| 서울·부산 데이터 · MOLIT 호출 · SEO | **변경 0** |
| `error_logs` | 실제 오류 시 기존 계약대로만(배포 후 dashboard 기록 0건) |

감사 스크립트는 SELECT만 하며 `DIAGNOSTIC` 가드를 거친다.

## 남은 대시보드 위험

1. **요약 캐시가 없어 매 갱신마다 14개 쿼리를 실제로 돈다.** 화면은 20초마다 자동
   갱신되므로 관리자 탭을 열어두면 20초마다 ~250ms씩 connection을 점유한다.
   오늘 지표의 parity 계약과 맞바꾼 비용이고, 현재 부하에서는 문제되지 않는다.
2. **`page_views`가 계속 자란다.** 지금 4,578행이라 여유가 크지만, 오늘 PV/30일 groupBy는
   이 테이블 크기에 비례한다. 수십만 행이 되면 이 라우트도 ops처럼 무거워진다.
3. **`connection_limit=1`의 출처는 여전히 미확인**(`DATABASE_URL`에 해당 파라미터 없음).
   §10에 따라 건드리지 않았다.
4. 파이프라인 헬스는 MOLIT 외부 호출이라 **DB와 무관하게** 느려질 수 있다. 5분 캐시가
   있고 실패해도 그 카드만 "확인 불가"가 되지만, latency 꼬리의 일부는 여기서 온다.

## 다음 권고

1. **ops의 cold latency(4~15초)가 남은 가장 큰 항목입니다.** 해결 수단은 사실상
   `@@index([lawdCd, dealCanceled])` 하나인데 **schema 변경이라 승인이 필요**합니다.
   승인해 주시면 영향 분석(기존 데이터·쓰기 경로·인덱스 크기)을 먼저 문서로 올리겠습니다.
2. `connection_limit`의 실제 출처를 확인하십시오. 지금은 우연한 기본값에 의존하고 있고,
   근거가 확인돼야 pool 설정을 **의도적으로** 정할 수 있습니다.
3. 관리자 외 일반 라우트에도 같은 `Promise.all` 패턴이 있는지 한 번 훑어보는 것을
   권합니다 — 이번 두 STEP은 관리자 화면만 봤습니다.
