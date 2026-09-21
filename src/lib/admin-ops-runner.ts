// ADMIN_OPS_P2024_CONNECTION_POOL_FIX_V1 — /admin/ops의 DB 집계를 "한 조각 실패가
// 화면 전체를 죽이지 않는" 구조로 돌리기 위한 순수 헬퍼. DOM/Prisma 의존 없음 → 테스트 가능.
//
// ── 왜 이런 구조가 필요했는가 (운영 원천 실측으로 확정) ─────────────────────────
//
// Production 오류: `[ADMIN_OPS_FAILURE][PrismaClientKnownRequestError:P2024]
// prisma.apartmentTradeHistory.count() — Timed out fetching a new connection from the
// connection pool (timeout 10s, connection limit 1)`.
//
// 직관적인 해석("count가 느려서 10초를 넘겼다")은 **틀렸다.** 같은 pool 조건에서 재현했다:
//
//   limit=1, pool_timeout=2s, 같은 9개 쿼리, 같은 총 DB 작업량
//     Promise.all  → latency 6,004ms, **7/9 rejected (전부 P2024)**
//     순차 await   → latency 6,164ms, **0/9 rejected**
//
// 차이는 "언제 connection을 요청하는가" 하나뿐이다. `Promise.all`은 9개가 **동시에**
// connection을 요청하므로 9개의 pool_timeout 타이머가 t=0에 함께 돌기 시작하고,
// 큐 뒤쪽 쿼리는 앞의 8개가 끝나기를 기다리다 타이머에 먼저 걸려 죽는다 — 실제 실행 시간이
// 30ms인 쿼리도 마찬가지다. 그래서 오류에 찍힌 `count()`는 **느린 쿼리가 아니라 줄 뒤에
// 서 있던 쿼리**였다. 순차 실행은 자기 차례가 왔을 때 비로소 connection을 요청하므로
// 대기 시간과 타이머가 겹치지 않는다.
//
// ── 시도했다가 버린 것 (측정으로 기각) ───────────────────────────────────────────
//
// "무거운 쿼리를 한 번의 스캔으로 합치기"는 **더 느렸다.** 운영 실측(limit=1, median of 3):
//   단일 FILTER 집계(COUNT(*) FILTER + COUNT(DISTINCT) + MAX)  15,335ms
//   raw GROUP BY lawd_cd, deal_canceled                          3,459ms
//   위가 대체하려던 기존 3개 쿼리 합계                            1,889ms
// 개별 쿼리는 이미 인덱스((lawd_cd, deal_date))를 타고 있고, 합치면 865k행 heap 스캔이 된다.
// **그래서 쿼리는 그대로 두고 실행 방식만 바꾼다.** 스키마/인덱스도 바꾸지 않는다.

/** 한 지표의 판정. 값이 없을 때 0으로 덮지 않기 위해 상태를 함께 싣는다. */
export type MetricResult<T> = { status: 'OK'; value: T } | { status: 'UNKNOWN'; value: null; error: string };

export function ok<T>(value: T): MetricResult<T> {
  return { status: 'OK', value };
}

export function unknown<T>(error: string): MetricResult<T> {
  return { status: 'UNKNOWN', value: null, error };
}

/**
 * 한 지표를 실행하고 실패를 **그 지표에만** 가둔다.
 *
 * 호출부는 반드시 하나씩 `await`한다 — pool=1에서 동시에 띄우면 위 주석의 P2024가 그대로
 * 재현된다. 병렬화가 필요해 보이더라도 여기서는 이득이 없다(실측: 병렬 2,331ms vs 순차 1,801ms).
 */
export async function isolate<T>(
  key: string,
  run: () => Promise<T>,
  onError?: (key: string, error: unknown) => void
): Promise<MetricResult<T>> {
  try {
    return ok(await run());
  } catch (e) {
    onError?.(key, e);
    return unknown<T>(describeError(e));
  }
}

/** 로그/응답에 실을 짧은 설명. 스택·연결 문자열 같은 민감 정보는 싣지 않는다. */
export function describeError(e: unknown): string {
  const code = (e as { code?: string })?.code;
  const name = (e as Error)?.name ?? 'Error';
  return code ? `${name}:${code}` : name;
}

/** 값이 있으면 그대로, 없으면 null. UI는 null을 "확인 불가"로 그린다(0으로 그리지 않는다). */
export function valueOf<T>(m: MetricResult<T>): T | null {
  return m.status === 'OK' ? m.value : null;
}

/**
 * 두 지표의 차(예: 유효 = 전체 − 취소). **하나라도 UNKNOWN이면 null**이다.
 *
 * 이 함수가 없으면 "취소 조회 실패 → 취소 0 → 유효 = 전체"가 되어, 장애가 **정상보다 더 좋은
 * 숫자**로 보인다. 거짓 0을 만들지 않기 위한 자리다.
 */
export function difference(total: MetricResult<number>, part: MetricResult<number>): number | null {
  if (total.status !== 'OK' || part.status !== 'OK') return null;
  return total.value - part.value;
}

/** 확인하지 못한 지표의 사람이 읽을 이름 목록 — 화면의 "확인 불가" 배너에 그대로 쓴다. */
export function unavailableLabels(entries: readonly { label: string; metric: MetricResult<unknown> }[]): string[] {
  return entries.filter((e) => e.metric.status === 'UNKNOWN').map((e) => e.label);
}

/**
 * DB 연결 자체가 죽은 것과 무거운 쿼리 하나가 타임아웃한 것을 구분한다(§5).
 *
 * 전자는 화면 전체가 실패인 것이 맞다. 후자는 그 카드만 "확인 불가"여야 한다.
 * 판정 근거는 **비율**이다 — 지표가 전부 실패했다면 개별 쿼리 문제로 보기 어렵다.
 */
export function isTotalDbOutage(metrics: readonly MetricResult<unknown>[]): boolean {
  if (metrics.length === 0) return false;
  return metrics.every((m) => m.status === 'UNKNOWN');
}

/**
 * ADMIN_OPS_P2024_CONNECTION_POOL_FIX_V1 §3-E/§10 — 한 지표에 시간 예산을 준다.
 *
 * 왜: 순차 실행으로 P2024는 사라졌지만 **콜드 시작 latency**가 남았다(운영 실측 10회:
 * P50 2,396ms, 첫 콜드 실행 13,048ms). 그 대부분이 `count(deal_canceled = true)` 하나다 —
 * `deal_canceled`를 덮는 인덱스가 없어 heap fetch가 필요하고, 실측이 1.2s~10s로 튄다.
 * (인덱스 추가는 schema 변경이라 이번 범위 밖이다.)
 *
 * 그래서 이 지표는 **맨 뒤에 두고** 예산을 준다. 예산을 넘기면 그 칸만 "확인 불가"로
 * 내려가고 나머지 화면은 즉시 뜬다. 중요한 성질: race로 응답을 먼저 보내도 원래 쿼리는
 * 계속 돌아 getOrSetCache에 결과를 채우므로, **다음 요청은 진짜 숫자를 본다.**
 * 값을 지어내지 않고 "아직 모른다"고 말할 뿐이다.
 */
export const BUDGET_EXCEEDED = 'BudgetExceeded';

export function withBudget<T>(run: () => Promise<T>, budgetMs: number): () => Promise<T> {
  return () =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const e = new Error(`metric exceeded ${budgetMs}ms budget`);
        e.name = BUDGET_EXCEEDED;
        reject(e);
      }, budgetMs);
      run().then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
}
