import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computePresaleStatus } from '@/services/cheongyakService';
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
      include: { houseTypeDetails: { orderBy: { modelNo: 'asc' } } },
    });

    if (!presale) {
      return NextResponse.json({ success: false, error: '분양정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: { ...presale, status: computePresaleStatus(presale) } });
  } catch (error) {
    console.error('Failed to fetch presale detail:', error);
    logServerError(buildErrorLogMessage('GET /api/presales/[id]', error), '/api/presales/[id]', (error as Error)?.stack).catch(() => {});
    return NextResponse.json({ success: false, error: '분양정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
