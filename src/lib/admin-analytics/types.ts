// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 §47 — data contract for the trusted behavior
// dashboard. Every count here comes from a session-level or event-level aggregate query —
// never a raw per-user/per-session row is exposed through this contract (§45).
export type AnalyticsRange = 'today' | '7d' | '30d';

export const ANALYTICS_RANGES: readonly AnalyticsRange[] = ['today', '7d', '30d'] as const;

export function isAnalyticsRange(value: string): value is AnalyticsRange {
  return (ANALYTICS_RANGES as readonly string[]).includes(value);
}

export interface BehaviorKpi {
  sessions: number; // distinct sessionId — "방문 세션" 표기 전용, "순 방문자"라고 표현하지 않는다(§11)
  pageViews: number;
  detailViews: number;
  compareStarts: number;
  favoriteAdds: number;
  financeFitCalculates: number;
  shareAttempts: number;
  shareSuccesses: number;
}

export interface JourneyFunnelStep {
  step: 'entry' | 'detail' | 'decisionAction';
  label: string;
  sessionCount: number;
  conversionFromPrevious: number | null; // null = 이전 단계 세션이 0이라 분모 없음
}

export interface FeatureUsageRow {
  feature: 'search' | 'map' | 'detail' | 'stats' | 'compare' | 'favorite' | 'financeFit' | 'share';
  label: string;
  count: number;
  trust: 'MEASURED' | 'PAGEVIEW_PROXY';
}

export interface PopularApartmentRow {
  complexId: string;
  aptName: string;
  lawdCd: string;
  dong: string;
  views: number;
}

export interface PopularRegionRow {
  lawdCd: string;
  dong: string;
  detailViews: number;
}

export interface NextActionBreakdownRow {
  actionType: string; // NextActionType 값 또는 "(미지정)" — Phase 2 이전에 기록된 이벤트는 actionType이 없다
  label: string;
  count: number;
}

export interface ShareStats {
  attempts: number;
  successes: number;
  successRate: number | null; // attempts === 0이면 null(0%로 표시하지 않는다)
}

export interface BehaviorSummary {
  range: AnalyticsRange;
  rangeLabel: string;
  /**
   * ADMIN_ANALYTICS_DATE_PARITY_FIX_V1 §9 — 이 집계가 실제로 재고 있는 창의 시작(ISO).
   * KST 달력일 경계다. 대시보드의 `todayStartsAt`과 같은 관례로, 두 화면이
   * 같은 창을 보고 있는지를 응답만으로 확인할 수 있게 한다.
   */
  rangeStartsAt: string;
  generatedAt: string;
  kpi: BehaviorKpi;
  funnel: JourneyFunnelStep[];
  featureUsage: FeatureUsageRow[];
  popularApartments: PopularApartmentRow[];
  popularRegions: PopularRegionRow[];
  nextActionBreakdown: NextActionBreakdownRow[];
  shareStats: ShareStats;
  // §44 — 정책 적용 시점 이전 데이터에는 QA 트래픽이 섞여 있을 수 있다는 정직한 안내.
  historicalDataNote: string;
}
