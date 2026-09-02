import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth-helpers';
import { classifyTraffic } from '@/lib/analytics/traffic-classification';
import { redactSearchQuery } from '@/lib/analytics/search-redaction';

export const dynamic = 'force-dynamic';

// 인기 검색어 통계용 로그. AI 검색(홈 검색창/추천칩/AI검색 페이지)이 실제로 질의를
// 실행하는 지점 한 곳(ai-search-client.tsx)에서만 호출해, 입력 중(onChange)이 아니라
// "실제로 검색을 실행한" 시점만 기록한다.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawQuery: string = (body.query || '').toString();
    // ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 §19-21 — redact 먼저, truncate는 그다음
    // (순서를 바꾸면 200자 경계에서 전화번호/이메일이 잘려 노출될 수 있다).
    const query: string = redactSearchQuery(rawQuery, 200);
    if (!query) return NextResponse.json({ success: false, error: 'query는 필수입니다.' }, { status: 400 });

    const user = await getCurrentUser().catch(() => null);

    const exclusionReason = classifyTraffic({
      userAgent: request.headers.get('user-agent'),
      user: user as any,
      qaSuppressed: body.qaSuppressed === true,
    });
    if (exclusionReason) {
      return NextResponse.json({ success: true, excluded: exclusionReason });
    }

    await prisma.searchLog.create({ data: { query, userId: user?.id ?? null } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('search log failed', error);
    return NextResponse.json({ success: false });
  }
}
