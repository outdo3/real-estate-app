import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 탭을 닫을 때 navigator.sendBeacon으로 호출된다 — ActiveSession 행을 즉시 지워서
// "30초 이상 무활동"이라는 수동적인 만료를 기다리지 않고 바로 실시간 접속자 목록에서
// 빠지게 한다. sendBeacon은 Content-Type을 강제로 text/plain으로 보내지만 body 자체는
// JSON 문자열이라 request.json()으로 그대로 파싱된다.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId: string = (body.sessionId || '').toString().slice(0, 100);
    if (!sessionId) return NextResponse.json({ success: false }, { status: 400 });

    await prisma.activeSession.deleteMany({ where: { sessionId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('leave log failed', error);
    return NextResponse.json({ success: false });
  }
}
