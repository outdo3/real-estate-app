const store = new Map<string, { value: unknown; expiresAt: number }>();

// 서버 인스턴스 생존 기간 동안만 유효한 TTL 캐시(재배포/재시작 시 초기화).
// MOLIT/NEIS 등 외부 API 응답처럼 자주 바뀌지 않는 데이터를 조건 키로 캐싱해,
// 같은 조건의 반복 요청이 매번 처음부터 재조회되는 것을 막는다.
export async function getOrSetCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fetcher();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
