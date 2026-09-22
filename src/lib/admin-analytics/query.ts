// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 — aggregate-only query layer. Every query here is
// COUNT/COUNT(DISTINCT)/GROUP BY — no raw-row materialization, no per-user/session row is ever
// selected out of this module (§39/§45). Funnel counting is session-based, never PageView-count-
// based (§26): a session that viewed the same detail page 10 times still counts once per stage.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NEXT_ACTION_TYPES, type NextActionType } from '@/lib/decision-journey/types';
import { startOfKstDay, startOfKstDaysAgo } from '@/lib/kst-day';
import { isolate, unavailableLabels, valueOf } from '@/lib/admin-ops-runner';
import { DECISION_ACTION_EVENT_URLS, ENGAGED_MIN_PAGE_VIEWS, INTERACTION_EVENT_URLS } from './engagement';
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
  REPORT: '한장 리포트',
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

/**
 * ADMIN_ANALYTICS_DATE_PARITY_FIX_V1 §6~§8 — 기간은 항상 **KST 달력일**이다.
 *
 * 이전 구현은 `new Date(); d.setHours(0,0,0,0)`이었다. `setHours`는 실행 환경의
 * 로컬 시간을 쓰는데 Vercel Function은 TZ=UTC로 돌아, 행동 분석의 "오늘"이
 * **한국시간 09:00에 시작**했다. 같은 순간 대시보드(KST)는 317을, 여기는 166을
 * 보여준 이유다(운영 실측). 대시보드는 ADMIN_DASHBOARD_TRUST_FIX_V1에서 이미
 * 고쳤고, 이 모듈만 남아 있었다.
 *
 * KST 계산 사본을 여기에 다시 만들지 않는다 — 대시보드와 **같은 helper**를 쓴다.
 *
 * 7일/30일도 rolling 7×24h가 아니라 **오늘을 포함한 최근 N개 KST 달력일**이다.
 * 화면 라벨이 "7일"이기 때문이다 — rolling은 조회 시각에 따라 가장 오래된 날의
 * 앞부분이 잘려, 오전에 본 "7일"과 저녁에 본 "7일"이 서로 다른 집합을 가리킨다.
 * 리포트(`resolveVolumePeriod`)도 이미 KST 달력일 계약이라 세 면이 같아진다.
 */
export function rangeStart(range: AnalyticsRange, now: Date = new Date()): Date {
  if (range === 'today') return startOfKstDay(now);
  const days = range === '7d' ? 7 : 30;
  return startOfKstDaysAgo(days - 1, now);
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
      -- §2/§5 — 방문 세션은 대시보드와 **같은 정의**를 쓴다: 이벤트 행을 제외한
      -- 실제 페이지뷰의 distinct session_id. 예전에는 여기만 이벤트 행까지 세어,
      -- 페이지뷰 없이 이벤트만 남긴 세션이 두 화면에서 다르게 세어질 수 있었다
      -- (오늘 실측 차이는 0이었지만, 정의가 같아야 우연이 아니다).
      -- entry_sessions와 같은 식이 되어 퍼널 1단계와도 자동으로 일치한다.
      COUNT(DISTINCT session_id) FILTER (WHERE url NOT LIKE '/__event__/%') as sessions,
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
      -- BEHAVIOR_FUNNEL_AUTO_EVENT_CLEANUP_V1 — 결정 행동은 engagement.ts의 DECISION_ACTION_EVENT_NAMES
      -- (비교 시작·관심 추가·자금 계산 실행). 자동 발생하는 finance_fit_start는 더 이상 세지 않는다.
      COUNT(DISTINCT session_id) FILTER (
        WHERE split_part(url, '?', 1) IN (${Prisma.join([...DECISION_ACTION_EVENT_URLS])})
      ) as decision_sessions
    FROM page_views
    WHERE created_at >= ${since}
  `;
  return rows[0];
}

/**
 * ADMIN_ENGAGED_SESSIONS_V1 — 참여 세션 수. **대시보드와 행동 분석이 모두 이 함수 하나를 쓴다**
 * (정의 사본을 두지 않는다 — 두 화면의 값이 우연이 아니라 구조적으로 같게).
 *
 * 의미는 `engagement.ts`의 `isEngagedSession` / `countEngagedSessionsInRows`와 같다:
 * 실제 페이지뷰 1건 이상 AND (페이지뷰 2건 이상 OR 상호작용 이벤트 1건 이상).
 * 상호작용 목록은 engagement.ts의 분류에서 만든다 — 자동 노출 이벤트(report_view 등)는 들어가지 않는다.
 * 세션별로 한 번 묶은 뒤 세므로 이벤트가 여러 건이어도 세션은 1로 센다. 집계만 반환한다.
 */
export async function countEngagedSessions(since: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM (
      SELECT session_id
      FROM page_views
      WHERE created_at >= ${since}
      GROUP BY session_id
      HAVING COUNT(*) FILTER (WHERE url NOT LIKE '/__event__/%') >= 1
         AND (
           COUNT(*) FILTER (WHERE url NOT LIKE '/__event__/%') >= ${ENGAGED_MIN_PAGE_VIEWS}
           OR COUNT(*) FILTER (WHERE split_part(url, '?', 1) IN (${Prisma.join([...INTERACTION_EVENT_URLS])})) >= 1
         )
    ) engaged
  `;
  return Number(rows[0]?.count ?? 0);
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

export interface BehaviorSummaryOptions {
  /** 한 지표만 실패했을 때 호출된다(라우트가 ADMIN_BEHAVIOR_METRIC_FAILURE로 기록). */
  onMetricError?: (key: string, error: unknown) => void;
}

/**
 * BEHAVIOR_ANALYTICS_CONNECTION_POOL_SAFETY_V1 — DB 쿼리를 **하나씩** await한다.
 *
 * 예전에는 5개를 `Promise.all`로 동시에 띄웠다. connection_limit=1에서는 5개의 pool_timeout
 * 타이머가 t=0에 함께 돌기 시작해, 다른 라우트(/api/admin/ops 등)가 connection을 잡고 있으면
 * 줄 뒤쪽 쿼리가 실행 시간과 무관하게 P2024로 죽는다(ops·dashboard에서 운영 실측으로 확정).
 * 순차 실행은 자기 차례에 비로소 connection을 요청한다. ops·dashboard와 같은 `isolate` 헬퍼를 쓴다.
 *
 * 부분 실패 계약:
 *   - 종합 집계(fetchCombinedCounts)는 KPI·퍼널·기능 사용량·공유 통계가 전부 여기서 나온다.
 *     이게 없으면 정직하게 보여줄 KPI가 없으므로 **예전처럼 전체 실패**(라우트가 500 + ADMIN_BEHAVIOR_FAILURE).
 *   - 나머지(참여 세션·검색 수·인기 단지·관심 지역·다음 행동)는 그 칸만 null이 되고
 *     `degradedMetrics`에 이름이 실린다. 0이나 빈 배열로 덮지 않는다(거짓 0 금지).
 */
export async function getBehaviorSummary(range: AnalyticsRange, options: BehaviorSummaryOptions = {}): Promise<BehaviorSummary> {
  const since = rangeStart(range);
  const m = <T,>(key: string, run: () => Promise<T>) => isolate(key, run, options.onMetricError);

  // 순서: 핵심 먼저(실패하면 나머지를 돌릴 이유가 없다), 그 뒤로 하나씩.
  const counts = await fetchCombinedCounts(since);
  const engagedM = await m('engagedSessions', () => countEngagedSessions(since));
  const searchCountM = await m('searchCount', () => prisma.searchLog.count({ where: { createdAt: { gte: since } } }));
  const popularApartmentsM = await m('popularApartments', () => fetchPopularApartments(since));
  const popularRegionsM = await m('popularRegions', () => fetchPopularRegions(since));
  const nextActionBreakdownM = await m('nextActionBreakdown', () => fetchNextActionBreakdown(since));

  const engagedSessions = valueOf(engagedM);
  const searchCount = valueOf(searchCountM);
  const popularApartments = valueOf(popularApartmentsM);
  const popularRegions = valueOf(popularRegionsM);
  const nextActionBreakdown = valueOf(nextActionBreakdownM);
  const degradedMetrics = unavailableLabels([
    { label: '참여 세션', metric: engagedM },
    { label: '검색(AI 검색) 수', metric: searchCountM },
    { label: '인기 단지 TOP 10', metric: popularApartmentsM },
    { label: '관심 지역 TOP 10', metric: popularRegionsM },
    { label: '다음 행동 유형', metric: nextActionBreakdownM },
  ]);

  const kpi: BehaviorKpi = {
    sessions: Number(counts.sessions),
    engagedSessions,
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
    // §9/§11 — 어느 창을 재고 있는지를 응답이 직접 말한다. 대시보드의
    // todayStartsAt과 같은 관례라, 두 화면의 parity를 화면 밖에서도 검증할 수 있다.
    rangeStartsAt: since.toISOString(),
    generatedAt: new Date().toISOString(),
    kpi,
    funnel,
    featureUsage,
    popularApartments,
    popularRegions,
    nextActionBreakdown,
    shareStats,
    degradedMetrics,
    historicalDataNote:
      '내부 테스트 제외 정책(관리자 세션·봇·비운영 환경·QA suppression) 적용 이전에 기록된 데이터에는 내부 테스트 활동이 일부 포함될 수 있습니다.',
  };
}
