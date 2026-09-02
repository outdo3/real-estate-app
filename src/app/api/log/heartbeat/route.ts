import { NextResponse } from 'next/server';
import { upsertActiveSession } from '@/lib/presence-server';
import { getCurrentUser } from '@/lib/auth-helpers';
import { classifyTraffic } from '@/lib/analytics/traffic-classification';

export const dynamic = 'force-dynamic';

// 30초 간격 하트비트 — ActiveSession.lastSeenAt만 갱신한다(그 값이 곧 "실시간
// 접속자" 판정 기준). 실패해도 무시: 사용자 경험에 영향을 주면 안 된다.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId: string = (body.sessionId || '').toString().slice(0, 100);
    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'sessionId는 필수입니다.' }, { status: 400 });
    }

    // ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 — 관리자/bot/비운영환경/QA suppression
    // 세션은 "실시간 접속자" 위젯에도 반영하지 않는다.
    const user = await getCurrentUser().catch(() => null);
    const exclusionReason = classifyTraffic({
      userAgent: request.headers.get('user-agent'),
      user: user as any,
      qaSuppressed: body.qaSuppressed === true,
    });
    if (exclusionReason) {
      return NextResponse.json({ success: true, excluded: exclusionReason });
    }

    await upsertActiveSession({
      sessionId,
      url: body.url ? String(body.url).slice(0, 500) : undefined,
      aptName: 'aptName' in body ? (body.aptName ? String(body.aptName).slice(0, 200) : null) : undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('heartbeat failed', error);
    return NextResponse.json({ success: false });
  }
}
