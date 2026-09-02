import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth-helpers';
import { upsertActiveSession } from '@/lib/presence-server';
import { classifyTraffic } from '@/lib/analytics/traffic-classification';

export const dynamic = 'force-dynamic';

// 페이지 이동 및 아파트 상세페이지 진입 로그. 로그인 여부와 무관하게 익명 세션 ID로
// 기록한다(비로그인 방문자도 트래픽 통계에 포함돼야 하므로) — 로그인 상태면 userId도
// 함께 남겨 향후 회원별 분석에 쓸 수 있게 한다.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url: string = (body.url || '').toString().slice(0, 500);
    const complexId: string | null = body.complexId ? String(body.complexId).slice(0, 200) : null;
    const aptName: string | null = body.aptName ? String(body.aptName).slice(0, 200) : null;
    const sessionId: string = (body.sessionId || '').toString().slice(0, 100);

    if (!url || !sessionId) {
      return NextResponse.json({ success: false, error: 'url/sessionId는 필수입니다.' }, { status: 400 });
    }

    const user = await getCurrentUser().catch(() => null);

    // ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 — bot/비운영환경/관리자 세션/QA suppression
    // 트래픽은 PageView/ActiveSession 어디에도 쓰지 않는다.
    const exclusionReason = classifyTraffic({
      userAgent: request.headers.get('user-agent'),
      user: user as any,
      qaSuppressed: body.qaSuppressed === true,
    });
    if (exclusionReason) {
      return NextResponse.json({ success: true, excluded: exclusionReason });
    }

    await Promise.all([
      prisma.pageView.create({
        data: { url, complexId, aptName, sessionId, userId: user?.id ?? null },
      }),
      upsertActiveSession({ sessionId, url, aptName, userId: user?.id ?? null }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    // 트래킹 실패가 실제 페이지 기능을 막으면 안 되므로 항상 200 계열로 조용히 무시한다 —
    // 클라이언트는 이 응답을 기다리거나 실패를 사용자에게 보여주지 않는다.
    console.warn('view log failed', error);
    return NextResponse.json({ success: false });
  }
}
