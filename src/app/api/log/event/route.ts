import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth-helpers';
import { isAnalyticsEventName, eventUrl } from '@/lib/analytics/events';

export const dynamic = 'force-dynamic';

// 범용 커스텀 이벤트 로그. /api/log/view와 동일한 관례(입력 검증/truncate/
// getCurrentUser/무조건 2xx 응답)를 그대로 재사용한다. eventName이 고정
// allow-list(src/lib/analytics/events.ts)에 없으면 DB에 아무것도 쓰지 않고
// 조용히 무시한다 — 임의 이벤트명/URL이 PageView 테이블에 쌓이는 것을 막는
// 유일한 게이트가 이 라우트다.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name: string = (body.name || '').toString();
    const sessionId: string = (body.sessionId || '').toString().slice(0, 100);

    if (!isAnalyticsEventName(name) || !sessionId) {
      return NextResponse.json({ success: true, ignored: true });
    }

    const complexId: string | null = body.complexId ? String(body.complexId).slice(0, 200) : null;
    const aptName: string | null = body.aptName ? String(body.aptName).slice(0, 200) : null;

    const user = await getCurrentUser().catch(() => null);

    await prisma.pageView.create({
      data: { url: eventUrl(name), complexId, aptName, sessionId, userId: user?.id ?? null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // 트래킹 실패가 실제 기능을 막으면 안 되므로 항상 200 계열로 조용히 무시한다.
    console.warn('event log failed', error);
    return NextResponse.json({ success: false });
  }
}
