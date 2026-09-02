import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth-helpers';
import { isAnalyticsEventName, eventUrl } from '@/lib/analytics/events';
import { NEXT_ACTION_TYPES } from '@/lib/decision-journey/types';
import { classifyTraffic } from '@/lib/analytics/traffic-classification';

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

    // ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 — bot/비운영환경/관리자 세션/QA suppression
    // 트래픽은 행을 아예 쓰지 않는다(태깅할 컬럼이 없어 쓰기 시점 필터가 유일한 방법).
    const exclusionReason = classifyTraffic({
      userAgent: request.headers.get('user-agent'),
      user: user as any,
      qaSuppressed: body.qaSuppressed === true,
    });
    if (exclusionReason) {
      return NextResponse.json({ success: true, excluded: exclusionReason });
    }

    // next_action_click만 actionType을 갖는다. 클라이언트가 보낸 값은 실제
    // NextActionType enum에 있을 때만 채택하고, 아니면 무시하고 actionType 없는
    // 일반 이벤트로 기록한다(이벤트 자체를 드롭하지 않음 — §17).
    const rawActionType: string | null = body.actionType ? String(body.actionType).slice(0, 40) : null;
    const actionType =
      name === 'next_action_click' && rawActionType && (NEXT_ACTION_TYPES as readonly string[]).includes(rawActionType)
        ? rawActionType
        : null;

    await prisma.pageView.create({
      data: { url: eventUrl(name, actionType), complexId, aptName, sessionId, userId: user?.id ?? null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // 트래킹 실패가 실제 기능을 막으면 안 되므로 항상 200 계열로 조용히 무시한다.
    console.warn('event log failed', error);
    return NextResponse.json({ success: false });
  }
}
