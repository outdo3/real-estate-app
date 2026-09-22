# E-JIP BEHAVIOR ANALYTICS CONNECTION POOL SAFETY V1

사용자 행동 분석(`/api/admin/behavior` → `getBehaviorSummary`)의 DB 쿼리를 `Promise.all`에서 **순차 실행**으로 바꿨다.
숫자·기간·참여·퍼널 정의 변경 0 · schema 0 · write 0 · UA/visitorId/bot filter 0.

## 1. 쿼리 그래프 (전부 DB, 외부 HTTP·순수 계산 없음)

| 순서 | 지표 | 테이블 | 종류 | 이전 | 이후 | 캐시 |
|---|---|---|---|---|---|---|
| 1 | 종합 집계(KPI·퍼널·기능 사용량·공유) `fetchCombinedCounts` | page_views | FILTER 집계 1스캔 | Promise.all | 순차 · **핵심**(실패 시 전체 실패) | 오늘 없음 · 7d/30d 5분 |
| 2 | 참여 세션 `countEngagedSessions` | page_views | GROUP BY session + HAVING | Promise.all 뒤 순차 | 순차 · isolate | 〃 |
| 3 | 검색 수 | search_logs | count | Promise.all | 순차 · isolate | 〃 |
| 4 | 인기 단지 | page_views | GROUP BY complex_id | Promise.all | 순차 · isolate | 〃 |
| 5 | 관심 지역 | page_views | GROUP BY | Promise.all | 순차 · isolate | 〃 |
| 6 | 다음 행동 유형 | page_views | GROUP BY | Promise.all | 순차 · isolate | 〃 |

이전 동시성: 1·3·4·5·6이 한 `Promise.all`(5개 동시), 2는 그 뒤. 이후: 6개 전부 하나씩 await. `Promise.all/allSettled` 0.
패턴은 ops·dashboard의 `src/lib/admin-ops-runner.ts`(`isolate`·`valueOf`·`unavailableLabels`) 그대로 — 새 추상화 없음.

## 2. 부분 실패 계약

- 종합 집계 실패 → **예전과 같이 전체 실패**(500 + `ADMIN_BEHAVIOR_FAILURE`). KPI·퍼널을 정직하게 보여줄 근거가 없다.
- 2~6 중 하나 실패 → 그 칸만 `null`, `degradedMetrics`에 이름, `ADMIN_BEHAVIOR_METRIC_FAILURE`로 기록(대시보드의 METRIC_FAILURE와 같은 역할, 기존 message-prefix 방식 — 새 error schema 없음).
- 화면: 숫자는 "확인 불가", 목록은 "확인 불가"(빈 배열 = "데이터 없음"과 구분), 상단 배너에 빠진 지표 이름. 거짓 0/[] 없음.
- 캐시: 7d/30d의 5분 TTL은 그대로. **부분 실패 결과는 캐시하지 않는다**(`shouldCache`) — ops의 "degraded를 5분간 붙잡지 않는다" 교훈. 오늘은 기존대로 캐시 없음.

## 3. 변경 전/후 parity (Production READ ONLY — 옛 구현을 그대로 복사한 모듈 ↔ 새 구현, 같은 프로세스에서 교대로)

| 범위 | delta | 방문 | 참여 | PV | 퍼널 | 시작(UTC) |
|---|---|---|---|---|---|---|
| 오늘 | **0** | 1 | 0 | 1 | 1 → 0 → 0 | 2026-09-21T15:00Z |
| 7일 | **0** | 352 | 6 | 381 | 352 → 130 → 0 | 2026-09-15T15:00Z |
| 30일 | **0** | 818 | 203 | 2,772 | 818 → 344 → 4 | 2026-08-23T15:00Z |

`generatedAt`과 새 `degradedMetrics`를 뺀 모든 필드(KPI·퍼널·기능 사용량·인기 단지·관심 지역·다음 행동·공유 통계·기간)가 첫 시도에 일치.

## 4. P2024 재현 (이 프로세스만의 pool — `connection_limit=1`, `pool_timeout=2s`, 다른 요청 역할 `SELECT pg_sleep(n)`; Production 앱 pool 무관)

| 점유 | Promise.all (6) | 순차 (6) | 옛 요약 | 새 요약 |
|---|---|---|---|---|
| 1.9s (< timeout) | **2/6 P2024** | **0/6** | OK(이번 회차는 통과 — 시점 의존) | OK |
| 3s (> timeout) | **6/6 P2024** | **1/6** (점유를 기다린 첫 쿼리만) | 실패 | 실패 |

순차 실행은 대기 시간이 쿼리 수만큼 **쌓이지 않는다**. 단, 점유가 pool_timeout보다 길면 첫 쿼리는 어떤 방식으로도 죽는다 —
새 순서에서 첫 쿼리는 핵심 집계이므로 그 경우 화면은 예전처럼 실패한다(운영 pool_timeout은 기본 10s, ops 최악 재조합은 VACUUM 후 2.5s).
단위 테스트에 같은 현상의 결정적 시뮬레이션(가짜 pool)을 넣었다.

## 5. 지연

로컬 → Production DB, 프로세스 내 30일 요약 10회: 이전 P50 44ms / P95 71ms → 이후 P50 118ms / P95 129ms(+~75ms, 6개 직렬).
배포 후 HTTP 측정은 아래 §7.

## 6. 테스트

`npx tsx --test src/lib/admin-analytics/behavior-pool-safety.test.ts src/lib/admin-analytics/engagement.test.ts src/lib/admin-analytics/date-parity.test.ts src/lib/admin-ops-runner.test.ts` → **69 pass / 0 fail**.
기존 배선 테스트 2개(오늘 캐시 우회 · 참여 세션 공유 함수)는 원문 문자열을 고정하던 것이라 새 호출 형태로 갱신했다(의미 동일).
`npx tsc --noEmit` src/ 0(전체 26 = 기존 25 + 이번 비교용으로 `tmp/`에 복사한 옛 모듈 1) · eslint 0 · build exit 0.
