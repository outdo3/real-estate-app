// MAP_SURROUNDING_MARKER_PERFORMANCE_V1 §14/§15 — src/app/map/page.tsx의 fetchAptMarkers가
// 쓰는 두 가지 순수 판정만 분리했다(부작용 없음 — map-selected-marker.ts와 동일 관례).
// 1) STALE BOUNDS REQUEST PROTECTION: 빠르게 연속으로 지역이 바뀌면 먼저 보낸 요청의
//    응답이 나중에 보낸 요청보다 늦게 도착할 수 있다 — 자신이 여전히 "가장 최근 요청"일
//    때만 반영해야 한다.
// 2) EXACT-KEY CACHE: 같은 lawdCd로 짧은 시간 안에 재진입하면 네트워크 재요청 없이 즉시
//    반영한다(실거래 데이터라 무기한 캐시는 위험해 TTL을 짧게 둔다).

export function isStaleMarkerResponse(requestSeq: number, latestSeq: number): boolean {
  return requestSeq !== latestSeq;
}

export function isMarkerCacheFresh(cachedAtMs: number, nowMs: number, ttlMs: number): boolean {
  return nowMs - cachedAtMs < ttlMs;
}
