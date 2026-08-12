import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-helpers';
import { getOrSetCache } from '@/lib/server-cache';
import { onlineSinceThreshold } from '@/lib/presence-server';
import { fetchMolitData } from '@/lib/api-molit';
import { detectLeadingRegionKeyword } from '@/lib/ai-search';

export const dynamic = 'force-dynamic';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

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

  try {
    const today = startOfToday();
    const onlineThreshold = onlineSinceThreshold();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      todayPageViews,
      todayUniqueSessions,
      onlineSessions,
      onlineAptGroups,
      popularAptGroups,
      todayNewUsers,
      totalUsers,
      recentSearches,
      todayNewPosts,
      todayNewComments,
      recentPosts,
      unresolvedReports,
      recentErrors,
      pipelineHealth,
    ] = await Promise.all([
      prisma.pageView.count({ where: { createdAt: { gte: today } } }),
      prisma.pageView.findMany({ where: { createdAt: { gte: today } }, select: { sessionId: true }, distinct: ['sessionId'] }),
      prisma.activeSession.findMany({ where: { lastSeenAt: { gte: onlineThreshold } } }),
      prisma.activeSession.groupBy({
        by: ['currentAptName'],
        where: { lastSeenAt: { gte: onlineThreshold }, currentAptName: { not: null } },
        _count: { currentAptName: true },
        orderBy: { _count: { currentAptName: 'desc' } },
        take: 10,
      }),
      prisma.pageView.groupBy({
        by: ['aptName'],
        where: { createdAt: { gte: thirtyDaysAgo }, aptName: { not: null } },
        _count: { aptName: true },
        orderBy: { _count: { aptName: 'desc' } },
        take: 10,
      }),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count(),
      prisma.searchLog.groupBy({
        by: ['query'],
        where: { createdAt: { gte: sevenDaysAgo } },
        _count: { query: true },
        orderBy: { _count: { query: 'desc' } },
        take: 10,
      }),
      prisma.post.count({ where: { createdAt: { gte: today } } }),
      prisma.comment.count({ where: { createdAt: { gte: today } } }),
      prisma.post.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, title: true, aptName: true, createdAt: true, author: { select: { name: true } } } }),
      prisma.report.count({ where: { resolved: false } }),
      prisma.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      checkPipelineHealth(),
    ]);

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

    return NextResponse.json({
      success: true,
      data: {
        traffic: {
          todayPageViews,
          todayUniqueVisitors: todayUniqueSessions.length,
          onlineNow: onlineSessions.length,
          todayNewUsers,
          totalUsers,
        },
        apartments: {
          realtime: onlineAptGroups.map((g) => ({ aptName: g.currentAptName, viewers: g._count.currentAptName })),
          popular30d: popularAptGroups.map((g) => ({ aptName: g.aptName, views: g._count.aptName })),
        },
        search: {
          topQueries: recentSearches.map((s) => ({ query: s.query, count: s._count.query })),
          topRegions: regionRanking,
        },
        community: {
          todayNewPosts,
          todayNewComments,
          recentPosts,
          unresolvedReports,
        },
        pipeline: pipelineHealth,
        errors: recentErrors,
      },
    });
  } catch (error) {
    console.error('Failed to build admin dashboard:', error);
    return NextResponse.json({ success: false, error: '대시보드 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
