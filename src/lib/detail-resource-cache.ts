// PERCEIVED_PERFORMANCE_V2_1 §3 — 상세페이지의 identity 기반 공개 GET을 위한
// 짧은 TTL 캐시 + in-flight 중복 제거.
//
// V2 DATAFLOW에서 실거래 요청(detail-trade-cache.ts)에만 적용했던 규칙을 공용 코어로
// 뽑았다. 재방문 실측에서 실거래는 0건으로 떨어졌지만 `/score`와 `/info`(2회)는 여전히
// 매번 다시 나갔다(V2 문서 §6.3).
//
// 캐시 안전 규칙(V2 §5와 동일 — 여기서 완화하지 않는다):
//   - **완전하게 성공한 응답만** 캐시한다. 판정은 호출부가 `isCacheable`로 넘긴다.
//     실패를 캐시하면 다음 방문에서 "성공한 빈 결과"로 굳어 FAILED가 ZERO로 접힌다.
//   - 이 판정은 HTTP 상태만으로는 부족하다. 예를 들어 `/api/apt/[name]/score`는
//     catch에서도 200 + status:'INSUFFICIENT_DATA'를 돌려준다(§43 — 데이터 부족을
//     사용자 오류로 만들지 않기 위한 의도된 설계). 그 응답을 캐시하면 **일시적 서버
//     오류가 TTL 동안 "점수 없음"으로 고정**된다. 그래서 호출부가 "진짜 성공"의 의미를
//     직접 정의한다.
//   - 저장 위치는 모듈 스코프 메모리뿐이다. sessionStorage/localStorage를 쓰지 않으므로
//     탭을 닫으면 사라지고 디스크·다른 탭에 남지 않는다.
//   - 키는 호출부가 canonical identity + 파라미터로 만든다. 이름만으로 만들지 않는다.

export interface CachedFetchOptions {
  /** canonical identity + 파라미터로 만든 키. URL 문자열이 아니라 의미 기반으로 만든다. */
  key: string;
  ttlMs: number;
  /**
   * 이 응답을 캐시해도 되는가. **완전하게 성공한 응답에만** true를 반환해야 한다.
   * 실패·부분 실패·에러를 위장한 성공 응답에는 반드시 false를 반환한다.
   */
  isCacheable: (payload: unknown, ok: boolean) => boolean;
}

export interface CachedFetchResult {
  ok: boolean;
  payload: unknown;
  fromCache: boolean;
}

/** 기본 TTL. 서버측 캐시(MOLIT 월 1시간)보다 훨씬 짧게 유지한다. */
export const DETAIL_RESOURCE_TTL_MS = 5 * 60 * 1000;

/** 한 세션에서 여러 단지를 오갈 때 메모리가 무한정 늘지 않도록 하는 상한. */
const MAX_ENTRIES = 48;

interface CacheEntry {
  payload: unknown;
  storedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CachedFetchResult>>();

function readCache(key: string, ttlMs: number): unknown | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > ttlMs) {
    cache.delete(key);
    return undefined;
  }
  return entry.payload;
}

function writeCache(key: string, payload: unknown): void {
  cache.set(key, { payload, storedAt: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    // Map은 삽입 순서를 유지하므로 첫 키가 가장 오래된 항목이다.
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * TTL 안의 **완전한** 성공 응답이 있으면 네트워크를 타지 않고, 같은 키의 요청이 이미
 * 떠 있으면 그 프로미스를 공유한다. 응답 payload는 해석하지 않고 그대로 돌려준다.
 */
export async function fetchCachedResource(
  url: string,
  options: CachedFetchOptions,
): Promise<CachedFetchResult> {
  const { key, ttlMs, isCacheable } = options;

  const cached = readCache(key, ttlMs);
  if (cached !== undefined) return { ok: true, payload: cached, fromCache: true };

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async (): Promise<CachedFetchResult> => {
    try {
      const response = await fetch(url);
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (isCacheable(payload, response.ok)) writeCache(key, payload);
      return { ok: response.ok, payload, fromCache: false };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

/** 테스트/개발용. 프로덕션 코드 경로에서는 호출하지 않는다. */
export function clearDetailResourceCache(): void {
  cache.clear();
  inflight.clear();
}
