import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 프론트/백엔드 에러 로그 수집. 지금은 ErrorBoundary(전역 클라이언트 에러)와 일부
// API route의 catch 블록만 연결돼 있다 — 전체 API route에 전역 계측을 거는 작업은
// 이번 세션 범위 밖이라, 우선 이 엔드포인트와 최소 연동 지점만 마련해뒀다.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const source: string = body.source === 'server' ? 'server' : 'client';
    const message: string = (body.message || '알 수 없는 오류').toString().slice(0, 2000);
    const stack: string | null = body.stack ? String(body.stack).slice(0, 5000) : null;
    const url: string | null = body.url ? String(body.url).slice(0, 500) : null;

    await prisma.errorLog.create({ data: { source, message, stack, url } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('error log failed', error);
    return NextResponse.json({ success: false });
  }
}
