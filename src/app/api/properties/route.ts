import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PropertyCategory } from '@prisma/client';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = ['OFFICETEL', 'LIVING_STAY', 'REDEVELOPMENT'] as const;

// 지도 카테고리 필터([오피스텔]/[생숙]/[재개발]) 선택 시 해당 category만 지연 조회하는
// 엔드포인트. category별로 실제 테이블이 다르다 — REDEVELOPMENT는 RedevelopmentProject를,
// 나머지는 Property를 조회한다. 아직 수집 파이프라인이 채운 실 데이터가 없는 카테고리는
// 정직하게 빈 배열을 반환한다(지어낸 매물을 보여주지 않는다).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = (searchParams.get('category') || '').toUpperCase();
  const lawdCd = searchParams.get('lawdCd') || undefined;

  if (!VALID_CATEGORIES.includes(category as any)) {
    return NextResponse.json(
      { success: false, error: `category는 ${VALID_CATEGORIES.join('/')} 중 하나여야 합니다.` },
      { status: 400 }
    );
  }

  try {
    if (category === 'REDEVELOPMENT') {
      const projects = await prisma.redevelopmentProject.findMany({
        where: lawdCd ? { lawdCd } : undefined,
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      return NextResponse.json({ success: true, category, data: projects });
    }

    const properties = await prisma.property.findMany({
      where: {
        category: category as PropertyCategory,
        ...(lawdCd ? { lawdCd } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return NextResponse.json({ success: true, category, data: properties });
  } catch (error) {
    console.error('Failed to fetch properties:', error);
    return NextResponse.json({ success: false, error: '데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
