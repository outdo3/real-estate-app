import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findNearbyApartments } from '@/lib/nearby-apartments';
import { logServerError, buildErrorLogMessage } from '@/lib/log-server-error';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const presaleId = Number(id);

  if (!Number.isInteger(presaleId) || presaleId <= 0) {
    return NextResponse.json({ success: false, error: '잘못된 분양정보 id입니다.' }, { status: 400 });
  }

  try {
    const presale = await prisma.presale.findUnique({
      where: { id: presaleId },
      select: { id: true, latitude: true, longitude: true },
    });

    if (!presale) {
      return NextResponse.json({ success: false, error: '분양정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 좌표가 없으면 반경 검색 기준점 자체가 없다 — 행정구역 대표좌표 등 임의 좌표를
    // 만들지 않고(M4-B/P2-D4-A 정책), 정상 응답으로 "위치정보 없음"만 명시한다.
    if (presale.latitude == null || presale.longitude == null) {
      return NextResponse.json({
        success: true,
        data: { presaleId, locationAvailable: false, radiusKm: null, totalCandidates: 0, items: [] },
      });
    }

    const { radiusKm, totalCandidates, items } = await findNearbyApartments(presale.latitude, presale.longitude);

    return NextResponse.json({
      success: true,
      data: { presaleId, locationAvailable: true, radiusKm, totalCandidates, items },
    });
  } catch (error) {
    console.error('Failed to fetch nearby apartments:', error);
    logServerError(buildErrorLogMessage('GET /api/presales/[id]/nearby-apartments', error), '/api/presales/[id]/nearby-apartments', (error as Error)?.stack).catch(() => {});
    return NextResponse.json({ success: false, error: '주변 아파트 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
