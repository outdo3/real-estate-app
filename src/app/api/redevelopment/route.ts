import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { listRedevelopmentProjects, InvalidRedevelopmentQueryError } from '@/lib/redevelopment/service';

export const dynamic = 'force-dynamic';

// STEP R5 — 재개발 목록 API. Prisma 쿼리를 여기서 직접 쓰지 않고 service.ts만 호출한다.
// 지원 query: sido, sigungu, businessType, stage, q(사업명 부분검색), page, pageSize.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const pageParam = searchParams.get('page');
  const pageSizeParam = searchParams.get('pageSize');

  try {
    const result = await listRedevelopmentProjects(prisma, {
      sido: searchParams.get('sido') || undefined,
      sigungu: searchParams.get('sigungu') || undefined,
      businessType: searchParams.get('businessType') || undefined,
      stage: searchParams.get('stage') || undefined,
      q: searchParams.get('q') || undefined,
      // page/pageSize가 숫자가 아니면(예: "abc") NaN이 되어 service.ts의 기본값 로직으로
      // 안전하게 떨어진다(500 대신 정상 응답, 섹션 20).
      page: pageParam ? Number(pageParam) : undefined,
      pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof InvalidRedevelopmentQueryError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error('Failed to fetch redevelopment projects:', error);
    return NextResponse.json({ success: false, error: '재개발 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
