// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 — aggregate-only query layer. Every query here is
// COUNT/COUNT(DISTINCT)/GROUP BY — no raw-row materialization, no per-user/session row is ever
// selected out of this module (§39/§45). Funnel counting is session-based, never PageView-count-
// based (§26): a session that viewed the same detail page 10 times still counts once per stage.
import { prisma } from '@/lib/prisma';
import { NEXT_ACTION_TYPES, type NextActionType } from '@/lib/decision-journey/types';
import type {
  AnalyticsRange,
  BehaviorKpi,
  BehaviorSummary,
  FeatureUsageRow,
  JourneyFunnelStep,
  NextActionBreakdownRow,
  PopularApartmentRow,
  PopularRegionRow,
  ShareStats,
} from './types';

const RANGE_LABELS: Record<AnalyticsRange, string> = { today: '오늘', '7d': '최근 7일', '30d': '최근 30일' };

const NEXT_ACTION_LABELS: Record<NextActionType, string> = {
  COMPARE: '비교',
  MAP: '지도',
  NEARBY: '주변 시설',
  FAVORITE: '관심단지',
  PRICE: '가격',
  TRANSACTIONS: '거래 내역',
  SCORE: '이집점수',
  BUDGET: '자금 계산',
  SEARCH: '검색',
  BACK_TO_RESULTS: '목록으로',
};

function rangeStart(range: AnalyticsRange): Date {
  const now = new Date();
  if (range === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days = range === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function conversion(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return current / previous;
}

interface CombinedCounts {
  sessions: bigint;
  page_views: bigint;
  detail_views: bigint;
  map_views: bigint;
  stats_views: bigint;
  compare_starts: bigint;
  favorite_adds: bigint;
  finance_fit_starts: bigint;
  finance_fit_calculates: bigint;
  share_attempts: bigint;
  share_successes: bigint;
  entry_sessions: bigint;
  detail_sessions: bigint;
  decision_sessions: bigint;
}

// 단일 SQL 쿼리로 KPI + 퍼널 세션 카운트를 한 번에 계산한다(같은 테이블·같은 range를
// 여러 번 스캔하지 않기 위해 — §40). FILTER (WHERE ...)로 조건별 집계를 한 번의
// 테이블 스캔 안에서 처리한다.
async function fetchCombinedCounts(since: Date): Promise<CombinedCounts> {
  const rows = await prisma.$queryRaw<CombinedCounts[]>`
    SELECT
      COUNT(DISTINCT session_id) as sessions,
      COUNT(*) FILTER (WHERE url NOT LIKE '/__event__/%') as page_views,
      COUNT(*) FILTER (WHERE url LIKE '/apt/%') as detail_views,
      COUNT(*) FILTER (WHERE url = '/map') as map_views,
      COUNT(*) FILTER (WHERE url LIKE '/stats%') as stats_views,
      COUNT(*) FILTER (WHERE url LIKE '/__event__/compare_start%') as compare_starts,
      COUNT(*) FILTER (WHERE url LIKE '/__event__/favorite_add%') as favorite_adds,
      COUNT(*) FILTER (WHERE url LIKE '/__event__/finance_fit_start%') as finance_fit_starts,
      COUNT(*) FILTER (WHERE url LIKE '/__event__/finance_fit_calculate%') as finance_fit_calculates,
      COUNT(*) FILTER (WHERE url LIKE '/__event__/share_attempt%') as share_attempts,
      COUNT(*) FILTER (WHERE url LIKE '/__event__/share_success%') as share_successes,
      COUNT(DISTINCT session_id) FILTER (WHERE url NOT LIKE '/__event__/%') as entry_sessions,
      COUNT(DISTINCT session_id) FILTER (WHERE url LIKE '/apt/%') as detail_sessions,
      COUNT(DISTINCT session_id) FILTER (
        WHERE url LIKE '/__event__/compare_start%'
           OR url LIKE '/__event__/favorite_add%'
           OR url LIKE '/__event__/finance_fit_start%'
      ) as decision_sessions
    FROM page_views
    WHERE created_at >= ${since}
  `;
  return rows[0];
}

async function fetchPopularApartments(since: Date): Promise<PopularApartmentRow[]> {
  // Phase 1 감사에서 지적된 대로, 기존 /admin/dashboard의 인기 단지 집계는 aptName만으로
  // 묶어 동명이인 단지가 섞일 위험이 있다(§14/§23). 여기서는 complexId(lawdCd|dong|name)로
  // 묶어 그 위험을 없앤다 — name-only grouping 금지.
  const rows = await prisma.$queryRaw<{ complex_id: string; apt_name: string | null; cnt: bigint }[]>`
    SELECT complex_id, apt_name, COUNT(*) as cnt
    FROM page_views
    WHERE created_at >= ${since} AND url LIKE '/apt/%' AND complex_id IS NOT NULL
    GROUP BY complex_id, apt_name
    ORDER BY cnt DESC
    LIMIT 10
  `;
  return rows.map((r) => {
    const [lawdCd = '', dong = '', name = ''] = r.complex_id.split('|');
    return { complexId: r.complex_id, aptName: r.apt_name || name, lawdCd, dong, views: Number(r.cnt) };
  });
}

async function fetchPopularRegions(since: Date): Promise<PopularRegionRow[]> {
  const rows = await prisma.$queryRaw<{ lawd_cd: string; dong: string; cnt: bigint }[]>`
    SELECT
      split_part(complex_id, '|', 1) as lawd_cd,
      split_part(complex_id, '|', 2) as dong,
      COUNT(*) as cnt
    FROM page_views
    WHERE created_at >= ${since} AND url LIKE '/apt/%' AND complex_id IS NOT NULL
    GROUP BY lawd_cd, dong
    ORDER BY cnt DESC
    LIMIT 10
  `;
  return rows.map((r) => ({ lawdCd: r.lawd_cd, dong: r.dong, detailViews: Number(r.cnt) }));
}

async function fetchNextActionBreakdown(since: Date): Promise<NextActionBreakdownRow[]> {
  const rows = await prisma.$queryRaw<{ action_type: string; cnt: bigint }[]>`
    SELECT
      CASE WHEN url LIKE '%?action=%' THEN split_part(url, 'action=', 2) ELSE '(미지정)' END as action_type,
      COUNT(*) as cnt
    FROM page_views
    WHERE created_at >= ${since} AND url LIKE '/__event__/next_action_click%'
    GROUP BY action_type
    ORDER BY cnt DESC
  `;
  return rows.map((r) => {
    const isKnown = (NEXT_ACTION_TYPES as readonly string[]).includes(r.action_type);
    const label = isKnown ? NEXT_ACTION_LABELS[r.action_type as NextActionType] : r.action_type === '(미지정)' ? '(미지정 — Phase 2 이전 기록)' : r.action_type;
    return { actionType: r.action_type, label, count: Number(r.cnt) };
  });
}

export async function getBehaviorSummary(range: AnalyticsRange): Promise<BehaviorSummary> {
  const since = rangeStart(range);

  const [counts, searchCount, popularApartments, popularRegions, nextActionBreakdown] = await Promise.all([
    fetchCombinedCounts(since),
    prisma.searchLog.count({ where: { createdAt: { gte: since } } }),
    fetchPopularApartments(since),
    fetchPopularRegions(since),
    fetchNextActionBreakdown(since),
  ]);

  const kpi: BehaviorKpi = {
    sessions: Number(counts.sessions),
    pageViews: Number(counts.page_views),
    detailViews: Number(counts.detail_views),
    compareStarts: Number(counts.compare_starts),
    favoriteAdds: Number(counts.favorite_adds),
    financeFitCalculates: Number(counts.finance_fit_calculates),
    shareAttempts: Number(counts.share_attempts),
    shareSuccesses: Number(counts.share_successes),
  };

  const entrySessions = Number(counts.entry_sessions);
  const detailSessions = Number(counts.detail_sessions);
  const decisionSessions = Number(counts.decision_sessions);

  // §28 — 정직한 수준의 라벨만 사용한다. "Search 전환율" 같은 표현은 실제 search
  // session 분모가 없어 쓰지 않는다.
  const funnel: JourneyFunnelStep[] = [
    { step: 'entry', label: '방문', sessionCount: entrySessions, conversionFromPrevious: null },
    { step: 'detail', label: '단지 상세 확인', sessionCount: detailSessions, conversionFromPrevious: conversion(detailSessions, entrySessions) },
    { step: 'decisionAction', label: '비교 / 관심 / 자금계산', sessionCount: decisionSessions, conversionFromPrevious: conversion(decisionSessions, detailSessions) },
  ];

  const featureUsage: FeatureUsageRow[] = [
    { feature: 'search', label: '검색(AI 검색)', count: searchCount, trust: 'MEASURED' },
    { feature: 'map', label: '지도', count: Number(counts.map_views), trust: 'PAGEVIEW_PROXY' },
    { feature: 'detail', label: '단지 상세', count: kpi.detailViews, trust: 'MEASURED' },
    { feature: 'stats', label: '통계', count: Number(counts.stats_views), trust: 'PAGEVIEW_PROXY' },
    { feature: 'compare', label: '비교', count: kpi.compareStarts, trust: 'MEASURED' },
    { feature: 'favorite', label: '관심단지 추가', count: kpi.favoriteAdds, trust: 'MEASURED' },
    { feature: 'financeFit', label: '자금 계산', count: kpi.financeFitCalculates, trust: 'MEASURED' },
    { feature: 'share', label: '공유 성공', count: kpi.shareSuccesses, trust: 'MEASURED' },
  ];

  const shareStats: ShareStats = {
    attempts: kpi.shareAttempts,
    successes: kpi.shareSuccesses,
    successRate: conversion(kpi.shareSuccesses, kpi.shareAttempts),
  };

  return {
    range,
    rangeLabel: RANGE_LABELS[range],
    generatedAt: new Date().toISOString(),
    kpi,
    funnel,
    featureUsage,
    popularApartments,
    popularRegions,
    nextActionBreakdown,
    shareStats,
    historicalDataNote:
      '내부 테스트 제외 정책(관리자 세션·봇·비운영 환경·QA suppression) 적용 이전에 기록된 데이터에는 내부 테스트 활동이 일부 포함될 수 있습니다.',
  };
}
