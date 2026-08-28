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
export async function getOrSetCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    try {
      const value = await fetcher();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
