import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computePresaleStatus, PresaleStatus } from '@/services/cheongyakService';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: PresaleStatus[] = ['upcoming', 'ongoing', 'closed', 'unsold'];

// status(upcoming/ongoing/closed/unsold)는 DB 컬럼이 아니라 날짜로부터 매 요청마다
// 계산한다(computePresaleStatus) — 그래서 이 필터링은 DB에서 status로 걸러낼 수 없고,
// 전체를 읽어와 계산 후 걸러야 한다. Presale 테이블 규모가 크지 않다는 전제(전국 분양
// 공고 수는 아파트 실거래량과 비교하면 훨씬 적다)하에 단순하게 구현했다 — 데이터가
// 수만 건 이상으로 커지면 status를 배치로 미리 계산해 컬럼화하는 편이 낫다.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');

  if (statusParam && !VALID_STATUSES.includes(statusParam as PresaleStatus)) {
    return NextResponse.json(
      { success: false, error: `status는 ${VALID_STATUSES.join('/')} 중 하나여야 합니다.` },
      { status: 400 }
    );
  }

  try {
    const presales = await prisma.presale.findMany({
      orderBy: { receiptStartDate: 'desc' },
      take: 300,
    });

    const withStatus = presales.map((p) => ({ ...p, status: computePresaleStatus(p) }));
    const filtered = statusParam ? withStatus.filter((p) => p.status === statusParam) : withStatus;

    return NextResponse.json({ success: true, data: filtered });
  } catch (error) {
    console.error('Failed to fetch presales:', error);
    return NextResponse.json({ success: false, error: '분양정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
