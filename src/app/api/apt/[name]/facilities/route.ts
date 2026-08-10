import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// scripts/crawl_facilities.py가 채워둔 단지 커뮤니티 시설(골프연습장, 수영장 등) 정보를
// 읽기만 하는 라우트 — 이 앱은 이 값을 실시간으로 조사하지 않는다. DB 연결이 아직
// 안 됐거나(로컬 개발 환경에서 DATABASE_URL 미설정 등) 해당 단지 레코드가 없으면
// facilities: null을 내려주고, 상세페이지는 이를 "정보 없음 + 제보하기" 상태로 표시한다
// — 값을 지어내지 않는다(이 앱의 다른 API들과 동일한 원칙).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const aptName = decodeURIComponent(name);
    const { searchParams } = new URL(request.url);
    const dong = searchParams.get('dong') || undefined;

    const record = dong
      ? await prisma.apartment.findFirst({ where: { name: aptName, dong } })
      : await prisma.apartment.findFirst({ where: { name: aptName } });

    const facilities = Array.isArray(record?.communityFacilities)
      ? (record!.communityFacilities as unknown[]).filter((v): v is string => typeof v === 'string')
      : null;

    return NextResponse.json({ facilities });
  } catch (error) {
    console.error('Failed to fetch apartment facilities:', error);
    return NextResponse.json({ facilities: null });
  }
}
