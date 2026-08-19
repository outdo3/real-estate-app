import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRedevelopmentProjectById } from '@/lib/redevelopment/service';

export const dynamic = 'force-dynamic';

// STEP R5 — 재개발 상세 API. rawPayload는 노출하지 않는다(service.ts 참고, 섹션 9).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'id는 양의 정수여야 합니다.' }, { status: 400 });
  }

  try {
    const project = await getRedevelopmentProjectById(prisma, id);
    if (!project) {
      return NextResponse.json({ success: false, error: '해당 재개발 사업을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    console.error('Failed to fetch redevelopment project detail:', error);
    return NextResponse.json({ success: false, error: '재개발 상세 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
