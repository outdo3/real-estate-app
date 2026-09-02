// ANALYTICS V1 — 범용 이벤트 트래킹의 고정 taxonomy. 이 배열에 없는 이벤트명은
// /api/log/event가 조용히 무시하고(200 no-op) DB에 절대 쓰지 않는다 — 임의
// 이벤트명/자유 형식 props가 이 테이블에 쌓이는 것을 코드 레벨에서 원천 차단한다.
//
// 저장 위치는 전용 Event 테이블이 아니라 기존 PageView 테이블이다(V1은 스키마
// 변경 없이 진행하기로 한 임시 저장 전략). 예약된 URL 네임스페이스
// `/__event__/<eventName>` 로 구분되며, 이 접두사는 admin dashboard의 기존
// PV/방문자/인기단지 집계 쿼리에서 명시적으로 제외된다(src/app/api/admin/dashboard/route.ts).
// Analytics V2에서 전용 Event 저장소로 옮길 때는 이 파일과 src/lib/analytics/trackEvent.ts,
// src/app/api/log/event/route.ts 세 곳의 저장 백엔드만 교체하면 되고, 호출부
// (FavoriteButton.tsx, useSharePage.ts 등)는 바뀌지 않는다.
export const ANALYTICS_EVENT_NAMES = [
  'favorite_add',
  'favorite_remove',
  'share_success',
  'share_attempt',
  'next_action_click',
  // COMPARE_V2_PHASE2 — share_success/share_attempt are already fired by ShareAction
  // itself for any page (Compare included) via useSharePage.ts; compare_share is kept
  // allowlisted per the Phase 2 spec's explicit ask but not separately wired this STEP
  // (no onShare hook exists on ShareAction to attach it to without touching that shared
  // component — see COMPARE_V2_PHASE2_IMPLEMENTATION.md limitations).
  'compare_start',
  'compare_add',
  'compare_remove',
  'compare_detail_click',
  'compare_share',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export function isAnalyticsEventName(value: string): value is AnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly string[]).includes(value);
}

export const ANALYTICS_EVENT_URL_PREFIX = '/__event__/';

export function eventUrl(name: AnalyticsEventName): string {
  return `${ANALYTICS_EVENT_URL_PREFIX}${name}`;
}
