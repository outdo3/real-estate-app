// ADMIN_ENGAGED_SESSIONS_V1 — "참여 세션" 정의의 단일 출처(순수 모듈, DB 없음).
//
// 왜 필요한가(docs/development/ANALYTICS_SESSION_ID_INTEGRITY_AUDIT_V1.md): "방문 세션"은
// sessionStorage 탭 세션의 COUNT(DISTINCT session_id)라 사람 수가 아니고, JS를 실행하는
// 크롤러에도 그대로 부푼다. 2026-09-21 KST의 319 세션 중 317이 1페이지·상호작용 0이었다.
// 그래서 **이미 쌓이고 있는 데이터만으로** "실제로 뭔가를 한 세션"을 따로 센다 — 새 수집 없음.
//
// 참여 세션 = 실제 페이지뷰가 1건 이상 있고, 그중
//   - 페이지뷰 2건 이상, 또는
//   - 사용자 상호작용 이벤트 1건 이상
// 인 세션. 페이지뷰 1건 이상을 요구하는 이유: 참여 세션이 방문 세션의 **부분집합**이어야
// 참여율(참여/방문)이 100%를 넘지 않는다. 이벤트만 남기고 페이지뷰가 없는 세션은 방문
// 세션에도 세지 않으므로(대시보드·행동 분석 공통 정의) 여기서도 세지 않는다.
import { ANALYTICS_EVENT_NAMES, ANALYTICS_EVENT_URL_PREFIX, type AnalyticsEventName } from '@/lib/analytics/events';

export type EventEngagement = 'INTERACTION' | 'AUTO';

/**
 * 모든 이벤트를 **빠짐없이** 분류한다. `Record<AnalyticsEventName, …>`라서 events.ts에
 * 이벤트가 추가되면 여기서 분류하기 전까지 타입 검사가 실패한다 — 새 이벤트가 조용히
 * 참여로(또는 비참여로) 새어 들어가지 않는다.
 *
 * AUTO = 사용자가 아무것도 누르지 않아도 렌더/마운트/화면 진입만으로 발생한다(코드로 확인).
 * INTERACTION = 사용자의 클릭·제출·선택 핸들러 안에서만 발생한다.
 */
export const EVENT_ENGAGEMENT: Record<AnalyticsEventName, EventEngagement> = {
  // FavoriteButton 클릭 핸들러
  favorite_add: 'INTERACTION',
  favorite_remove: 'INTERACTION',
  // 공유 시트의 채널 선택 후(useShareSheet)
  share_success: 'INTERACTION',
  share_attempt: 'INTERACTION',
  share_kakao: 'INTERACTION',
  share_native: 'INTERACTION',
  share_copy: 'INTERACTION',
  // NextActionSection handleClick
  next_action_click: 'INTERACTION',
  // CompareV2 — 검색 결과 선택(start/add), 제거, 상세 이동 버튼
  compare_start: 'INTERACTION',
  compare_add: 'INTERACTION',
  compare_remove: 'INTERACTION',
  compare_detail_click: 'INTERACTION',
  compare_share: 'INTERACTION', // allowlist에만 있고 현재 호출부 없음 — 생기면 공유 동작이다
  // finance-fit-client의 useEffect(최초 마운트 1회) — 이름과 달리 **페이지 로드**다
  finance_fit_start: 'AUTO',
  // handleCalculate(계산 버튼), 상세·비교의 자금계산 이동 버튼
  finance_fit_calculate: 'INTERACTION',
  finance_fit_from_detail: 'INTERACTION',
  finance_fit_from_compare: 'INTERACTION',
  // InstallBanner — view는 배너 표시 effect, 나머지는 버튼/프롬프트 응답
  pwa_install_banner_view: 'AUTO',
  pwa_install_click: 'INTERACTION',
  pwa_install_accept: 'INTERACTION',
  pwa_install_dismiss: 'INTERACTION',
  pwa_install_guide_open: 'INTERACTION',
  // ReportActions — view는 마운트 effect, 나머지 셋은 버튼
  report_view: 'AUTO',
  report_image_save: 'INTERACTION',
  report_pdf_save: 'INTERACTION',
  report_share: 'INTERACTION',
  // usePartnerCta — impression은 IntersectionObserver(스크롤로 보이기만 해도), click은 버튼
  partner_cta_impression: 'AUTO',
  partner_cta_click: 'INTERACTION',
  // AptLocationCard — map_view는 화면에 들어온 시점, 나머지는 모드 전환 버튼
  detail_map_view: 'AUTO',
  detail_roadview_open: 'INTERACTION',
  detail_map_return: 'INTERACTION',
  // 개인화 점수 — card/compare view는 렌더 effect, 나머지는 링크 클릭·저장
  personal_fit_settings_cta_click: 'INTERACTION',
  personal_fit_login_cta_click: 'INTERACTION',
  personal_fit_settings_save: 'INTERACTION',
  personal_fit_card_view: 'AUTO',
  personal_fit_compare_view: 'AUTO',
  // feedback-client — open은 /feedback 마운트 effect, submit은 제출
  feedback_open: 'AUTO',
  feedback_submit: 'INTERACTION',
};

export const INTERACTION_EVENT_NAMES: readonly AnalyticsEventName[] = ANALYTICS_EVENT_NAMES.filter(
  (name) => EVENT_ENGAGEMENT[name] === 'INTERACTION'
);

export const AUTO_EVENT_NAMES: readonly AnalyticsEventName[] = ANALYTICS_EVENT_NAMES.filter(
  (name) => EVENT_ENGAGEMENT[name] === 'AUTO'
);

/** SQL `split_part(url, '?', 1) IN (...)`에 그대로 쓰는 값. next_action_click처럼 `?action=`이 붙는 이벤트도 잡는다. */
export const INTERACTION_EVENT_URLS: readonly string[] = INTERACTION_EVENT_NAMES.map((name) => `${ANALYTICS_EVENT_URL_PREFIX}${name}`);

export const ENGAGED_MIN_PAGE_VIEWS = 2;

export function isEngagedSession(s: { pageViews: number; interactionEvents: number }): boolean {
  if (s.pageViews < 1) return false;
  return s.pageViews >= ENGAGED_MIN_PAGE_VIEWS || s.interactionEvents >= 1;
}

/** page_views.url 한 줄이 상호작용 이벤트인지. 페이지뷰·자동 이벤트·목록 밖 이벤트는 false. */
export function isInteractionEventUrl(url: string): boolean {
  if (!url.startsWith(ANALYTICS_EVENT_URL_PREFIX)) return false;
  const name = url.slice(ANALYTICS_EVENT_URL_PREFIX.length).split('?')[0];
  return (EVENT_ENGAGEMENT as Record<string, EventEngagement | undefined>)[name] === 'INTERACTION';
}

/**
 * SQL(`countEngagedSessions`)과 **같은 의미**의 행 단위 참조 구현. 테스트와 운영 교차 검증용이다.
 * `since`를 주면 그 순간 이상(>=)의 행만 센다 — SQL의 `created_at >= since`와 같다.
 */
export function countEngagedSessionsInRows(
  rows: readonly { sessionId: string; url: string; createdAt?: Date }[],
  since?: Date
): number {
  const bySession = new Map<string, { pageViews: number; interactionEvents: number }>();
  for (const r of rows) {
    if (since && r.createdAt && r.createdAt.getTime() < since.getTime()) continue;
    const s = bySession.get(r.sessionId) ?? { pageViews: 0, interactionEvents: 0 };
    if (!r.url.startsWith(ANALYTICS_EVENT_URL_PREFIX)) s.pageViews++;
    else if (isInteractionEventUrl(r.url)) s.interactionEvents++;
    bySession.set(r.sessionId, s);
  }
  let n = 0;
  for (const s of bySession.values()) if (isEngagedSession(s)) n++;
  return n;
}

/** 참여율 = 참여 세션 / 방문 세션. 분모가 0이거나 어느 한쪽을 확인하지 못했으면 null(0%로 보이지 않게). */
export function engagedRate(engaged: number | null | undefined, visits: number | null | undefined): number | null {
  if (engaged == null || visits == null || visits <= 0) return null;
  return engaged / visits;
}
