import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

// 인기 검색어 통계용 로그. AI 검색(홈 검색창/추천칩/AI검색 페이지)이 실제로 질의를
// 실행하는 지점 한 곳(ai-search-client.tsx)에서만 호출해, 입력 중(onChange)이 아니라
// "실제로 검색을 실행한" 시점만 기록한다.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query: string = (body.query || '').toString().trim().slice(0, 200);
    if (!query) return NextResponse.json({ success: false, error: 'query는 필수입니다.' }, { status: 400 });

    const user = await getCurrentUser().catch(() => null);
    await prisma.searchLog.create({ data: { query, userId: user?.id ?? null } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('search log failed', error);
    return NextResponse.json({ success: false });
  }
}
