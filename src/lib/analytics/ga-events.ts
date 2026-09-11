import { ANALYTICS_EVENT_NAMES, type AnalyticsEventName } from './events';

/**
 * GA4_INTEGRATION_V1 §9 — 1st-party 이벤트명 → GA4 이벤트명 매핑의 **유일한 원본**.
 *
 * 규칙:
 *  - 이 표에 없는 1st-party 이벤트는 GA4로 나가지 않는다(기본값이 "보내지 않음").
 *  - GA4 이벤트명은 소문자 snake_case 고정 문자열만 쓴다. 동적 생성 금지 —
 *    GA4는 속성당 이벤트 이름 수에 상한이 있어 동적 이름은 조용히 유실된다.
 *  - 1st-party는 그대로 두고 GA4 쪽 이름만 바꾸고 싶을 때도 이 파일만 고친다.
 *
 * GA4에 **일부러 보내지 않는 것**과 그 이유:
 *  - heartbeat / leave / 조회 로그  : 고빈도 노이즈. GA4의 세션·참여도는 이미 gtag가 잰다.
 *  - share_attempt                  : share_success의 선행 단계라 같은 행동이 두 번 잡힌다.
 *  - compare_remove                 : 이탈 신호는 제품 분석(1st-party) 영역이다.
 *  - next_action_click / finance_fit_* : 제품(의사결정 여정) 분석이라 1st-party가 이미
 *    actionType까지 들고 있다. GA4는 유입/획득 레이어로 한정한다(§1 이중 분석 원칙).
 *    필요해지면 이 표에 한 줄씩 추가하면 되고, 다른 파일은 손대지 않는다.
 */
export const GA_EVENT_MAP: Partial<Record<AnalyticsEventName, string>> = {
  // 재방문 의도(§13)
  favorite_add: 'favorite_add',
  favorite_remove: 'favorite_remove',

  // 확산/획득. GA4 권장 이벤트명 `share`를 그대로 써서 기본 리포트에 잡히게 한다.
  share_success: 'share',

  // 비교 퍼널(§14). compare_view는 만들지 않는다 — /compare 진입은 page_view가 이미
  // 잡고 있어서, 분석을 위해 제품에 새 이벤트를 심을 이유가 없다.
  compare_start: 'compare_start',
  compare_add: 'compare_add',
  compare_detail_click: 'compare_detail_click',
  compare_share: 'compare_share',

  // 리포트 퍼널(§11)
  report_view: 'report_view',
  report_image_save: 'report_image_save',
  report_pdf_save: 'report_pdf_save',
  report_share: 'report_share',

  // PWA 설치 퍼널(§12). 기존 1st-party 이벤트를 그대로 쓴다 — 새로 심지 않는다.
  pwa_install_banner_view: 'pwa_install_banner_view',
  pwa_install_click: 'pwa_install_click',
  pwa_install_accept: 'pwa_install_accept',
  pwa_install_dismiss: 'pwa_install_dismiss',
  pwa_install_guide_open: 'pwa_install_guide_open',

  // PARTNER_LEAD_TRACKING_V1 §9 — 예약만 해두었던 파트너 이벤트를 실제로 연결한다.
  // GA4 쪽 이름도 1st-party와 같게 두어 두 시스템의 숫자를 바로 비교할 수 있게 한다.
  partner_cta_impression: 'partner_cta_impression',
  partner_cta_click: 'partner_cta_click',
};

/**
 * §15 — 파트너 CTA.
 *
 * PARTNER_LEAD_TRACKING_V1에서 **실제로 연결됐다**(위 GA_EVENT_MAP 참고). 이 배열은
 * 이제 "예약 목록"이 아니라 파트너 관련 이벤트가 이 둘뿐임을 고정하는 계약이다.
 *
 * call_connected / consultation_completed 처럼 **측정 수단이 없는 성과 이벤트는
 * 여전히 만들지 않는다** — 있으면 언젠가 추정값으로 채워질 위험이 있다. click은
 * 상담 성사가 아니며, 성사 귀속은 확인 수단이 생긴 뒤의 별도 STEP이다(§13).
 */
export const GA_RESERVED_PARTNER_EVENTS = ['partner_cta_impression', 'partner_cta_click'] as const;

/** GA4 이벤트명 규칙(§9): 소문자 snake_case, 40자 이내, 숫자로 시작하지 않음. */
const GA_EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export function isValidGaEventName(name: string): boolean {
  return GA_EVENT_NAME_PATTERN.test(name);
}

/** 매핑된 GA4 이벤트명. 매핑이 없으면 null(=GA4로 보내지 않는다). */
export function toGaEventName(name: AnalyticsEventName): string | null {
  return GA_EVENT_MAP[name] ?? null;
}

/** 매핑 표가 실제 taxonomy 안에만 존재하는지 확인하는 용도(테스트/디버깅). */
export function gaMappedFirstPartyEvents(): AnalyticsEventName[] {
  return ANALYTICS_EVENT_NAMES.filter((n) => GA_EVENT_MAP[n]);
}
