import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-helpers';
import { getOrSetCache } from '@/lib/server-cache';
import { onlineSinceThreshold } from '@/lib/presence-server';
import { fetchMolitData } from '@/lib/api-molit';
import { detectLeadingRegionKeyword } from '@/lib/ai-search';
import { ANALYTICS_EVENT_URL_PREFIX } from '@/lib/analytics/events';
import { startOfKstDay, startOfKstDaysAgo } from '@/lib/kst-day';
import { logAdminFailure } from '@/lib/admin/log-admin-failure';
// ADMIN_OPS_P2024_CONNECTION_POOL_FIX_V1에서 검증된 패턴을 그대로 재사용한다(새 추상화 없음).
import { isTotalDbOutage, isolate, unavailableLabels, valueOf } from '@/lib/admin-ops-runner';

export const dynamic = 'force-dynamic';

// ADMIN_DASHBOARD_TRUST_FIX_V1 §1 — 예전에는 `new Date(); d.setHours(0,0,0,0)`이었다.
// `setHours`는 실행 환경 로컬 자정이라 Vercel(TZ=UTC)에서는 "오늘"이 **한국시간 09:00**에
// 시작했고, 매일 그 시각에 오늘 지표가 0으로 리셋됐다(감사 §5에서 151 → 60으로 재현).
// 이제 런타임 TZ와 무관하게 KST 자정을 쓴다.
const startOfToday = startOfKstDay;

// ADMIN_DASHBOARD_CONNECTION_POOL_SAFETY_V1 §4 — 7일/30일 집계의 짧은 TTL.
// 화면은 20초마다 자동 갱신되는데 이 세 집계는 그 사이에 의미 있게 변하지 않는다.
// 목적은 latency보다 **connection 점유 시간 단축**이다 — pool=1에서는 그것이
// 같은 pool을 쓰는 다른 라우트(/api/admin/ops 등)에게 가장 큰 도움이 된다.
// 실패한 값은 애초에 캐시되지 않는다(fetcher가 throw하면 getOrSetCache가 저장하지 않음)
// — 그래서 ops처럼 별도의 degraded TTL이 필요 없다. 다음 요청이 그대로 재시도한다.
const SLOW_METRIC_TTL_MS = 60 * 1000;

// 실제로 살아있는 공공 API를 가볍게 한 번씩 호출해 "정상/오류"를 판정한다 — 배치
// 파이프라인이 따로 없는 이 앱에서는 "마지막 수집 완료 시각" 같은 로그가 없으므로,
// 대신 "마지막으로 실제 응답을 확인한 시각"을 보여준다(대시보드를 열 때마다 매번
// 외부 API를 두드리지 않도록 5분 TTL로 캐시한다).
async function checkPipelineHealth() {
  return getOrSetCache('admin-dashboard:pipeline-health', 5 * 60 * 1000, async () => {
    const now = new Date();
    const dealYmd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const molitCheck = (async () => {
      try {
        // 부산 서구 — 이 서비스의 기본 대상 지역으로 가볍게 확인한다.
        const trades = await fetchMolitData({ type: 'apt', lawdCd: '26140', dealYmd });
        const failed = Array.isArray(trades) && trades.length === 1 && (trades[0] as any)?.typeLabel === '에러';
        return failed ? '오류' : '정상';
      } catch {
        return '오류';
      }
    })();

    // 청약홈/건축물대장은 아래에서 "API 키 존재 여부"만으로 상태를 정했었는데(STEP 1
    // 감사에서 지적됨), 이는 실제 호출 성공 여부를 의미하지 않는다. 이번 대시보드 로딩마다
    // 새로 외부 API를 호출하는 구조는 추가하지 않기로 했으므로(비용/레이트리밋/속도 문제),
    // 두 항목은 코드로 확인 가능한 실제 사실만 반영해 라벨을 바로잡는다.
    //
    // - 청약홈(syncApplyhomeListings, src/services/cheongyakService.ts)은 함수 자체가
    //   어떤 크론/스크립트/관리자 액션에서도 호출되지 않는다(구조만 준비된 상태, 실제
    //   수집 경로 없음 — 확인 완료) → "미연동"으로 표시. 실패가 아니라 아직 연결되지
    //   않은 상태이므로 "오류"라고 하지 않는다.
    // - 건축물대장(fetchBuildingRegistryInfo, src/lib/apt-building-info.ts)은 반대로
    //   /api/apt/[name]/info 등 실제 사용자 화면에서 라이브로 호출되고 있음이 코드로
    //   확인된다 — 다만 이 헬스체크 자체는 그 호출을 직접 검증하지 않고 키 존재만
    //   확인하므로 "정상"이라 단정하지 않고 "설정됨"으로 표시한다. ("실사용은 확인되지만
    //   이 헬스체크 자체의 실시간 상태 점검은 미구현"이라는 상세 설명은 화면 문구에는
    //   담지 않고 docs/development/01-5B-admin-api-status-integrity.md에 기록한다 —
    //   STEP 1.5-B 검수에서 화면 문구는 짧게, 분석 근거는 문서에 남기기로 함.)
    const cheongyakKeyConfigured = !!process.env.DATA_GO_KR_API_KEY;
    const registryKeyConfigured = !!process.env.DATA_GO_KR_API_KEY;

    const molitStatus = await molitCheck;
    const checkedAt = new Date().toISOString();

    return [
      { name: '국토부 실거래가(MOLIT)', status: molitStatus, checkedAt },
      {
        name: '청약홈 분양정보',
        status: cheongyakKeyConfigured ? '미연동(API 키만 설정됨)' : '미연동(API 키 미설정)',
        checkedAt,
      },
      {
        name: '건축물대장',
        status: registryKeyConfigured ? '설정됨' : '미설정(API 키 없음)',
        checkedAt,
      },
    ];
  });
}

export async function GET() {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  const startedAt = Date.now();
  try {
    const today = startOfToday();
    const onlineThreshold = onlineSinceThreshold();
    // ADMIN_ANALYTICS_DATE_PARITY_FIX_V1 §8 — 화면 라벨이 "최근 7일"/"최근 30일"이므로
    // 기간도 **오늘을 포함한 KST 달력일**로 읽는다. rolling N×24h는 조회 시각에 따라
    // 가장 오래된 날의 앞부분이 잘려 같은 날에도 집합이 달라진다. 행동 분석·리포트와
    // 같은 계약을 쓴다(기간 의미가 화면마다 모순되지 않게).
    const sevenDaysAgo = startOfKstDaysAgo(6);
    const thirtyDaysAgo = startOfKstDaysAgo(29);

    // ADMIN_DASHBOARD_CONNECTION_POOL_SAFETY_V1 §1~§3 — 예전에는 이 14개 DB 쿼리를
    // 한 번의 `Promise.all`로 동시에 띄웠다. `/api/admin/ops`를 죽였던 바로 그 구조다.
    //
    // 이 라우트만 놓고 보면 지금은 안전하다 — 테이블이 작아(page_views 4,578행) 14개 합이
    // ~650ms면 끝난다(실측). 위험은 **포트를 나눠 쓰는 다른 라우트**에서 온다.
    // prisma는 싱글턴이라 /api/admin/ops(busanCanceled 실측 1.2~10s)와 **같은 pool**을 쓴다.
    // 그쪽이 connection을 잡고 있는 동안 여기서 Promise.all을 띄우면 14개의 pool_timeout
    // 타이머가 **함께** 돌기 시작해 전원이 대기 중에 죽는다. 재현 실측(3초 점유, pool_timeout=2s):
    //
    //     Promise.all → **14/14 rejected (전부 P2024)**
    //     순차        → **1/14 rejected** (점유를 기다린 첫 개만)
    //
    // 그래서 ops에서 검증된 패턴을 그대로 쓴다 — 하나씩 await + 지표별 isolate().
    const noteMetricFailure = (key: string, e: unknown) => {
      console.error(`[admin/dashboard] 지표 조회 실패: ${key}`, e);
      // §5 — 전체 실패(ADMIN_DASHBOARD_FAILURE)와 구분되는 category.
      // 무엇이 빠졌는지는 아래 degradedMetrics가 응답으로 내려준다.
      logAdminFailure({ category: 'ADMIN_DASHBOARD_METRIC_FAILURE', endpoint: '/api/admin/dashboard', error: e, metricKey: key });
    };
    const m = <T,>(key: string, run: () => Promise<T>) => isolate(key, run, noteMetricFailure);

    // 파이프라인 헬스는 **외부 HTTP**(MOLIT)라 DB connection을 잡지 않는다.
    // 먼저 착수시켜 DB 순차 실행과 시간을 겹치게 하고 마지막에 거둔다(기존 병렬성 유지).
    const pipelinePromise = isolate('pipelineHealth', () => checkPipelineHealth(), noteMetricFailure);

    const todayPageViewsM = await m('todayPageViews', () =>
      prisma.pageView.count({ where: { createdAt: { gte: today }, url: { not: { startsWith: ANALYTICS_EVENT_URL_PREFIX } } } })
    );
    // SUPABASE_EGRESS_P1_CLEANUP — 예전에는 `findMany({ select:{sessionId}, distinct:['sessionId'] })`
    // 였다. Prisma의 distinct는 **가져온 뒤 클라이언트에서** 중복을 제거하므로, 고유 세션 수를
    // 세자고 오늘 page_view 행을 전부 전송받고 있었다. DB 집계(COUNT DISTINCT)로 바꿈 —
    // page_views.session_id는 NOT NULL이라 개수가 정확히 같다(스키마 확인함).
    const todaySessionsM = await m('todayVisitSessions', () =>
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT session_id) AS count
        FROM page_views
        WHERE created_at >= ${today} AND url NOT LIKE ${ANALYTICS_EVENT_URL_PREFIX + '%'}
      `
    );
    const onlineSessionsM = await m('onlineSessions', () => prisma.activeSession.count({ where: { lastSeenAt: { gte: onlineThreshold } } }));
    const onlineAptGroupsM = await m('onlineAptGroups', () =>
      prisma.activeSession.groupBy({
        by: ['currentAptName'],
        where: { lastSeenAt: { gte: onlineThreshold }, currentAptName: { not: null } },
        _count: { currentAptName: true },
        orderBy: { _count: { currentAptName: 'desc' } },
        take: 10,
      })
    );
    // §4 — 7일/30일 집계는 분 단위로 의미가 바뀜지 않는다. 짧게 캐시해 **connection 점유
    // 시간 자체를 줄인다** — pool=1에서는 그것이 다른 라우트에 주는 가장 큰 선물이다.
    // 오늘 지표(PV/세션/신규가입/글/댓글/실시간)는 **캐시하지 않는다** —
    // ADMIN_ANALYTICS_DATE_PARITY_FIX_V1 §9에서 행동 분석과 같은 순간을 보게 만든 계약을
    // 캐시로 다시 깨뜨릴 수 없다(그때 delta 0을 운영에서 확인했다).
    const popularAptGroupsM = await m('popular30d', () =>
      getOrSetCache('admin-dashboard:popular-30d', SLOW_METRIC_TTL_MS, () =>
        prisma.pageView.groupBy({
          by: ['aptName'],
          where: {
            createdAt: { gte: thirtyDaysAgo },
            aptName: { not: null },
            url: { not: { startsWith: ANALYTICS_EVENT_URL_PREFIX } },
          },
          _count: { aptName: true },
          orderBy: { _count: { aptName: 'desc' } },
          take: 10,
        })
      )
    );
    const todayNewUsersM = await m('todayNewUsers', () => prisma.user.count({ where: { createdAt: { gte: today } } }));
    const totalUsersM = await m('totalUsers', () => prisma.user.count());
    const recentSearchesM = await m('recentSearches', () =>
      getOrSetCache('admin-dashboard:top-searches-7d', SLOW_METRIC_TTL_MS, () =>
        prisma.searchLog.groupBy({
          by: ['query'],
          where: { createdAt: { gte: sevenDaysAgo } },
          _count: { query: true },
          orderBy: { _count: { query: 'desc' } },
          take: 10,
        })
      )
    );
    const todayNewPostsM = await m('todayNewPosts', () => prisma.post.count({ where: { createdAt: { gte: today } } }));
    const todayNewCommentsM = await m('todayNewComments', () => prisma.comment.count({ where: { createdAt: { gte: today } } }));
    const recentPostsM = await m('recentPosts', () =>
      prisma.post.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, title: true, aptName: true, createdAt: true, author: { select: { name: true } } } })
    );
    const unresolvedReportsM = await m('unresolvedReports', () => prisma.report.count({ where: { resolved: false } }));
    const recentErrorsM = await m('recentErrors', () => prisma.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }));
    // ANALYTICS V1 — 이벤트는 PageView를 재활용하되 /__event__/ 접두사로 분리 저장된다
    // (src/lib/analytics/events.ts). 위 todayPageViews/todayVisitSessions/popularAptGroups는
    // 이 접두사를 명시적으로 제외해 실제 페이지뷰 지표를 오염하지 않고, 이벤트는 여기서만
    // 최근 7일 집계로 별도 노출한다.
    const eventCountsM = await m('eventCounts', () =>
      getOrSetCache('admin-dashboard:events-7d', SLOW_METRIC_TTL_MS, () =>
        prisma.pageView.groupBy({
          by: ['url'],
          where: { createdAt: { gte: sevenDaysAgo }, url: { startsWith: ANALYTICS_EVENT_URL_PREFIX } },
          _count: { url: true },
          orderBy: { _count: { url: 'desc' } },
        })
      )
    );

    const pipelineHealthM = await pipelinePromise;

    // §3 — 지표가 **전부** 실패했을 때만 DB 연결 자체 장애로 보고 전체 실패로 올린다.
    // 한 지표가 느려서 죽은 것과 DB가 죽은 것은 다르게 생겼다(ops와 같은 기준).
    const dbMetrics = [
      todayPageViewsM, todaySessionsM, onlineSessionsM, onlineAptGroupsM, popularAptGroupsM,
      todayNewUsersM, totalUsersM, recentSearchesM, todayNewPostsM, todayNewCommentsM,
      recentPostsM, unresolvedReportsM, recentErrorsM, eventCountsM,
    ];
    if (isTotalDbOutage(dbMetrics)) {
      throw new Error('대시보드 지표를 하나도 읽지 못했다(연결 자체 실패로 판단)');
    }

    const recentSearches = valueOf(recentSearchesM) ?? [];
    const onlineAptGroups = valueOf(onlineAptGroupsM);
    const popularAptGroups = valueOf(popularAptGroupsM);
    const eventCounts = valueOf(eventCountsM);

    // 검색어 텍스트에서 지역 키워드를 코드 레벨로 추출해 "관심 지역" 통계로 집계한다
    // (SearchLog에 지역 컬럼이 따로 없어 애플리케이션에서 파싱) — ai-search.ts의
    // 파서를 그대로 재사용해 AI 검색 지역 인식 로직과 결과가 어긋나지 않게 한다.
    const regionInterest = new Map<string, number>();
    for (const s of recentSearches) {
      const detected = detectLeadingRegionKeyword(s.query);
      if (detected) {
        const label = `${detected.sido} ${detected.sigungu}`;
        regionInterest.set(label, (regionInterest.get(label) || 0) + s._count.query);
      }
    }
    const regionRanking = Array.from(regionInterest.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // §3/§6 — 무엇을 확인하지 못했는지를 숨기지 않는다. ops의 degradedSources와 같은 관례.
    const degradedMetrics = unavailableLabels([
      { label: '오늘 페이지뷰', metric: todayPageViewsM },
      { label: '오늘 방문 세션', metric: todaySessionsM },
      { label: '실시간 접속자', metric: onlineSessionsM },
      { label: '실시간 인기 아파트', metric: onlineAptGroupsM },
      { label: '누적 인기 단지(30일)', metric: popularAptGroupsM },
      { label: '신규 가입', metric: todayNewUsersM },
      { label: '총 회원', metric: totalUsersM },
      { label: '인기 검색어·관심 지역', metric: recentSearchesM },
      { label: '오늘 신규 게시글', metric: todayNewPostsM },
      { label: '오늘 신규 댓글', metric: todayNewCommentsM },
      { label: '최근 작성글', metric: recentPostsM },
      { label: '미처리 신고', metric: unresolvedReportsM },
      { label: '최근 오류', metric: recentErrorsM },
      { label: '이벤트 집계(7일)', metric: eventCountsM },
      { label: '파이프라인 상태', metric: pipelineHealthM },
    ]);

    return NextResponse.json({
      success: true,
      data: {
        degradedMetrics,
        traffic: {
          todayPageViews: valueOf(todayPageViewsM),
          // ADMIN_DASHBOARD_TRUST_FIX_V1 §3 — 이 값은 COUNT(DISTINCT session_id)다.
          // session_id는 `sessionStorage` 기반이라(src/lib/live-presence.ts) 한 사람이 탭을
          // 두 개 열면 2로 센다. "방문자 수"가 아니라 **방문 세션 수**이므로 이름도 그렇게 둔다
          // — 예전 이름 todayUniqueVisitors가 화면 라벨까지 사람 수처럼 보이게 만들었다.
          // §6 — 조회가 실패했을 때 0으로 내려보내지 않는다. "오늘 방문 0"은 장애가
          // 아니라 **사실**로 읽힌다 — 확인하지 못한 것과 구분돼야 한다.
          todayVisitSessions: todaySessionsM.status === 'OK' ? Number(todaySessionsM.value[0]?.count ?? 0) : null,
          onlineNow: valueOf(onlineSessionsM),
          todayNewUsers: valueOf(todayNewUsersM),
          totalUsers: valueOf(totalUsersM),
          // §9 — 이 숫자가 "언제 기준"인지 운영자가 스스로 판단할 수 있게 한다.
          // 오늘 범위의 시작(KST 자정)과 조회 시각을 함께 내려준다.
          todayStartsAt: today.toISOString(),
          fetchedAt: new Date().toISOString(),
        },
        apartments: {
          // 배열도 마찬가지다 — 조회 실패를 빈 배열(= "아무도 없음")로 보여주지 않는다.
          realtime: onlineAptGroups ? onlineAptGroups.map((g) => ({ aptName: g.currentAptName, viewers: g._count.currentAptName })) : null,
          popular30d: popularAptGroups ? popularAptGroups.map((g) => ({ aptName: g.aptName, views: g._count.aptName })) : null,
        },
        search: {
          topQueries: recentSearchesM.status === 'OK' ? recentSearches.map((s) => ({ query: s.query, count: s._count.query })) : null,
          topRegions: recentSearchesM.status === 'OK' ? regionRanking : null,
        },
        community: {
          todayNewPosts: valueOf(todayNewPostsM),
          todayNewComments: valueOf(todayNewCommentsM),
          recentPosts: valueOf(recentPostsM),
          unresolvedReports: valueOf(unresolvedReportsM),
        },
        pipeline: valueOf(pipelineHealthM),
        errors: valueOf(recentErrorsM),
        events: eventCounts
          ? eventCounts.map((e) => ({
              name: e.url.slice(ANALYTICS_EVENT_URL_PREFIX.length),
              count: e._count.url,
            }))
          : null,
      },
    });
  } catch (error) {
    console.error('Failed to build admin dashboard:', error);
    // ADMIN_ERROR_LOGGING_P1_V1 §2 — 운영자가 실제로 겪는 실패 경로. 응답은 그대로 500이고,
    // 기록은 best-effort라 이 호출이 실패 처리 자체를 바꾸지 않는다.
    logAdminFailure({
      category: 'ADMIN_DASHBOARD_FAILURE',
      endpoint: '/api/admin/dashboard',
      error,
      latencyMs: Date.now() - startedAt,
    });
    return NextResponse.json({ success: false, error: '대시보드 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
