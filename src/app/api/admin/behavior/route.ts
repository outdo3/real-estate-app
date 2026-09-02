import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { getOrSetCache } from '@/lib/server-cache';
import { getBehaviorSummary } from '@/lib/admin-analytics/query';
import { isAnalyticsRange, type AnalyticsRange } from '@/lib/admin-analytics/types';

export const dynamic = 'force-dynamic';

// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 — /api/admin/dashboard와 동일한 5분 TTL
// 캐시 관례를 재사용한다(§38/§49 — 기존 admin 캐시 컨벤션과 다른 새 숫자를 만들지 않음).
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const url = new URL(request.url);
    const rawRange = url.searchParams.get('range') || '7d';
    // §48 — allowlist 밖 임의 range 파라미터로 비싼 쿼리를 실행하지 못하게 한다.
    const range: AnalyticsRange = isAnalyticsRange(rawRange) ? rawRange : '7d';

    const data = await getOrSetCache(`admin-behavior:${range}`, CACHE_TTL_MS, () => getBehaviorSummary(range));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Failed to build admin behavior summary:', error);
    return NextResponse.json({ success: false, error: '행동 분석 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
