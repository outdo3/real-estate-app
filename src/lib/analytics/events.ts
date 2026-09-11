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
  // FINANCE_FIT_V1_PHASE2A — 금액/금리 등 numeric payload는 절대 함께 보내지 않는다
  // (trackEvent의 TrackEventContext 자체가 complexId/aptName만 지원해 구조적으로 막혀 있다).
  'finance_fit_start',
  'finance_fit_calculate',
  'finance_fit_from_detail',
  'finance_fit_from_compare',
  // PWA_INSTALL_UX_V1 §20 — 설치 UX 이벤트. 기존 allowlist 메커니즘을 그대로 쓰며
  // 새 third-party analytics를 추가하지 않는다. payload는 없다(이름만 기록).
  'pwa_install_banner_view',
  'pwa_install_click',
  'pwa_install_accept',
  'pwa_install_dismiss',
  'pwa_install_guide_open',
  // GA4_INTEGRATION_V1 §11 — 리포트 퍼널. 스키마 변경 없이 기존 `/__event__/<name>`
  // 네임스페이스를 그대로 쓴다. report_view만 진입(마운트) 이벤트이고 나머지 셋은
  // 전부 **사용자가 실제로 버튼을 눌렀을 때만** 발생한다(렌더로 발생하지 않는다).
  'report_view',
  'report_image_save',
  'report_pdf_save',
  'report_share',
  // PARTNER_LEAD_TRACKING_V1 §9/§13 — 제휴 파트너 CTA. 스키마 변경 없이 기존
  // `/__event__/<name>` 네임스페이스를 그대로 쓴다.
  //
  // **이름이 곧 의미다.** click은 "버튼을 눌렀다"까지만 뜻하며 상담 성사가 아니다.
  // lead / conversion / consultation_complete 류의 이름을 쓰지 않는 이유이고,
  // 실제 성사 여부를 확인할 수단이 생기기 전에는 그런 이벤트를 만들지 않는다.
  //
  // 이 라우트는 이름 외에 complexId/aptName만 저장하므로, channel(kakao|phone)과
  // placement 같은 분해 축은 **GA4 쪽에만** 실린다(§12 — 알려진 비대칭).
  'partner_cta_impression',
  'partner_cta_click',
  // APT_DETAIL_INLINE_MAP_ROADVIEW_V1 §19 — 상세 인라인 위치 카드.
  // 의미 있는 상호작용만 센다: 지도가 실제로 붙은 시점 1회, 그리고 사용자가 직접
  // 누른 모드 전환. **패닝/줌은 보내지 않는다** — 고빈도 노이즈이고 알아야 할 것을
  // 알려주지도 않는다. 좌표·단지명·주소는 payload에 실리지 않는다(이름만 기록).
  'detail_map_view',
  'detail_roadview_open',
  'detail_map_return',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export function isAnalyticsEventName(value: string): value is AnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly string[]).includes(value);
}

export const ANALYTICS_EVENT_URL_PREFIX = '/__event__/';

// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 §15-17 — next_action_click만 actionType을
// 갖는다. 스키마 변경 없이(새 컬럼 없이) 기존 `/__event__/<name>` URL 네임스페이스 안에
// `?action=<NextActionType>` 쿼리로 인코딩한다. 서버(route.ts)가 NEXT_ACTION_TYPES
// 배열로 다시 검증하므로, 클라이언트가 임의 문자열을 보내도 유효하지 않으면 무시되고
// actionType 없는 일반 이벤트로만 기록된다(이벤트 자체를 드롭하지 않음).
export function eventUrl(name: AnalyticsEventName, actionType?: string | null): string {
  const base = `${ANALYTICS_EVENT_URL_PREFIX}${name}`;
  if (actionType) return `${base}?action=${encodeURIComponent(actionType)}`;
  return base;
}
