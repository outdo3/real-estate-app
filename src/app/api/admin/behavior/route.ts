import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { getOrSetCache } from '@/lib/server-cache';
import { getBehaviorSummary } from '@/lib/admin-analytics/query';
import { isAnalyticsRange, type AnalyticsRange } from '@/lib/admin-analytics/types';
import { logAdminFailure } from '@/lib/admin/log-admin-failure';

export const dynamic = 'force-dynamic';

// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 — /api/admin/dashboard와 동일한 5분 TTL
// 캐시 관례를 재사용한다(§38/§49 — 기존 admin 캐시 컨벤션과 다른 새 숫자를 만들지 않음).
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  const startedAt = Date.now();
  try {
    const url = new URL(request.url);
    const rawRange = url.searchParams.get('range') || '7d';
    // §48 — allowlist 밖 임의 range 파라미터로 비싼 쿼리를 실행하지 못하게 한다.
    const range: AnalyticsRange = isAnalyticsRange(rawRange) ? rawRange : '7d';

    // ADMIN_ANALYTICS_DATE_PARITY_FIX_V1 §9/§10 — "오늘"은 캐시하지 않는다.
    //
    // /api/admin/dashboard의 트래픽 지표는 캐시 없이 매번 집계한다. 여기만 5분
    // TTL을 두면, 두 계약을 똑같이 맞춰도 운영자가 두 화면을 나란히 놓고 볼 때
    // **최대 5분치 트래픽만큼 숫자가 달라** 다시 "왜 다르냐"가 된다.
    //
    // 7일/30일은 더 무거운 집계이고 분 단위로 의미가 바뀌지 않으므로 기존 5분
    // 캐시 관례를 그대로 유지한다(관리자 전용 화면 · 초단위 polling 추가 없음).
    const data =
      range === 'today'
        ? await getBehaviorSummary(range)
        : await getOrSetCache(`admin-behavior:${range}`, CACHE_TTL_MS, () => getBehaviorSummary(range));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Failed to build admin behavior summary:', error);
    logAdminFailure({
      category: 'ADMIN_BEHAVIOR_FAILURE',
      endpoint: '/api/admin/behavior',
      error,
      latencyMs: Date.now() - startedAt,
    });
    return NextResponse.json({ success: false, error: '행동 분석 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
