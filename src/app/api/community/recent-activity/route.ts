import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 지도 마커 칩의 "최신 글 있음" 뱃지용. Post.aptName(자유 텍스트 태그) 기준 최근 24시간
// 이내 게시글 개수를 단지명별로 집계해 돌려준다 — 마커 렌더링은 클라이언트에서 하므로
// (map/page.tsx가 실거래 기반으로 마커 좌표/목록을 직접 구성), 여기서는 이름→개수 맵만
// 가볍게 내려주고 클라이언트가 자기 마커 목록에 병합한다.
export async function GET() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const groups = await prisma.post.groupBy({
      by: ['aptName'],
      where: { aptName: { not: null }, createdAt: { gte: since } },
      _count: { aptName: true },
    });

    const counts: Record<string, number> = {};
    for (const g of groups) {
      if (g.aptName) counts[g.aptName] = g._count.aptName;
    }

    return NextResponse.json({ success: true, data: counts });
  } catch (error) {
    console.error('Failed to fetch recent community activity:', error);
    return NextResponse.json({ success: false, error: '최신 글 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
