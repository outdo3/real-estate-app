const store = new Map<string, { value: unknown; expiresAt: number }>();
// STATISTICS PERFORMANCE V1 §7/§21 — 같은 cold cacheKey로 동시에 들어온 여러
// 요청(예: 사용자 두 명이 거의 동시에 "서울 전체 거래량"을 여는 경우)이 각각
// fetcher()를 따로 실행하면 MOLIT fetch storm이 그대로 배가된다. 진행 중인
// fetcher 실행을 key별로 공유해 두 번째 이후 호출은 같은 Promise를 기다리게
// 한다(cache key/TTL 의미는 전혀 바뀌지 않음 — 완료 시점에 store에 한 번만
// 기록된다). 성공/실패 어느 쪽이든 완료되면 반드시 in-flight map에서 제거해
// 메모리 누수와 "영구 실패 캐싱"을 막는다.
const inFlight = new Map<string, Promise<unknown>>();

// 서버 인스턴스 생존 기간 동안만 유효한 TTL 캐시(재배포/재시작 시 초기화).
// MOLIT/NEIS 등 외부 API 응답처럼 자주 바뀌지 않는 데이터를 조건 키로 캐싱해,
// 같은 조건의 반복 요청이 매번 처음부터 재조회되는 것을 막는다.
// APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX §CACHE_SAFETY — 일부 fetcher(MOLIT 월별
// 조회)는 실패해도 throw하지 않고 "실패를 표현하는 값"을 반환한다. 그 값이 성공 결과와
// 같은 TTL 캐시에 들어가면 한 번의 스로틀링이 그 셀을 TTL 내내 축소된 값으로 고정한다.
// shouldCache는 "이 값은 캐시에 남기지 말라"를 호출부가 정하게 한다. 옵션을 주지 않으면
// 기존과 완전히 동일하게 무조건 캐시하므로, 이 함수를 쓰는 다른 라우트는 영향받지 않는다.
export interface GetOrSetCacheOptions<T> {
  shouldCache?: (value: T) => boolean;
}

export async function getOrSetCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options?: GetOrSetCacheOptions<T>
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    try {
      const value = await fetcher();
      if (!options?.shouldCache || options.shouldCache(value)) {
        store.set(key, { value, expiresAt: Date.now() + ttlMs });
      }
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
