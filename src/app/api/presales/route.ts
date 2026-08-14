import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { computePresaleStatus, PresaleStatus } from '@/services/cheongyakService';
import { logServerError, buildErrorLogMessage } from '@/lib/log-server-error';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: PresaleStatus[] = ['upcoming', 'ongoing', 'closed', 'unsold'];
const PAGE_SIZE = 20;

// 만원 단위. "최고 분양가(maxPrice)" 기준 구간 — 실 데이터 분포(2026-08-13 확인, 총 1,046건:
// ~3억 45 / ~5억 174 / ~7억 306 / ~10억 233 / 10억초과 288)로 검증된 구간이다.
const PRICE_MAX_THRESHOLDS: Record<string, number> = {
  '30000': 30000,
  '50000': 50000,
  '70000': 70000,
  '100000': 100000,
};

// 상태는 DB 컬럼이 아니라 날짜로부터 매 요청마다 계산한다(computePresaleStatus) — 그래서
// status 필터/정렬은 DB에서 걸러낼 수 없고, region/priceMax로 1차로 줄인 뒤 전체를 읽어와
// JS에서 계산·필터·정렬해야 한다. Presale 규모(1,046건)가 크지 않다는 기존 전제를 그대로
// 유지한다 — 데이터가 수만 건 이상으로 커지면 status를 배치로 미리 계산해 컬럼화하는 편이 낫다.
const STATUS_PRIORITY: Record<PresaleStatus, number> = {
  ongoing: 0,
  upcoming: 1,
  closed: 2,
  unsold: 3,
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');
  const regionParam = searchParams.get('region')?.trim() || undefined;
  const priceMaxParam = searchParams.get('priceMax')?.trim() || undefined;
  const pageParam = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);

  if (statusParam && !VALID_STATUSES.includes(statusParam as PresaleStatus)) {
    return NextResponse.json(
      { success: false, error: `status는 ${VALID_STATUSES.join('/')} 중 하나여야 합니다.` },
      { status: 400 }
    );
  }
  if (priceMaxParam && priceMaxParam !== 'over' && !(priceMaxParam in PRICE_MAX_THRESHOLDS)) {
    return NextResponse.json(
      { success: false, error: 'priceMax는 30000/50000/70000/100000/over 중 하나여야 합니다.' },
      { status: 400 }
    );
  }

  try {
    const where: Prisma.PresaleWhereInput = {};
    if (regionParam) where.subscriptionAreaName = regionParam;
    if (priceMaxParam === 'over') {
      where.maxPrice = { gt: PRICE_MAX_THRESHOLDS['100000'] };
    } else if (priceMaxParam) {
      where.maxPrice = { lte: PRICE_MAX_THRESHOLDS[priceMaxParam] };
    }

    const [presales, regionGroups] = await Promise.all([
      prisma.presale.findMany({ where, orderBy: { receiptStartDate: 'desc' } }),
      prisma.presale.groupBy({
        by: ['subscriptionAreaName'],
        _count: { _all: true },
        orderBy: { _count: { subscriptionAreaName: 'desc' } },
      }),
    ]);

    const withStatus = presales.map((p) => ({ ...p, status: computePresaleStatus(p) }));
    const filtered = statusParam ? withStatus.filter((p) => p.status === statusParam) : withStatus;

    // 접수중/접수예정을 상단에 고정 노출하고(현재 데이터는 각각 0/7건), 그 안에서는
    // 최근 모집공고순 — P2-D1(§F) 결론대로 상태를 과도하게 세분화하지 않으면서도
    // "지금 청약 가능한 공고"가 아카이브에 묻히지 않도록 한다.
    const sorted = [...filtered].sort((a, b) => {
      const priorityDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (priorityDiff !== 0) return priorityDiff;
      const aTime = a.receiptStartDate ? a.receiptStartDate.getTime() : 0;
      const bTime = b.receiptStartDate ? b.receiptStartDate.getTime() : 0;
      return bTime - aTime;
    });

    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(pageParam, totalPages);
    const items = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const regions = regionGroups
      .map((g) => g.subscriptionAreaName)
      .filter((name): name is string => Boolean(name));

    return NextResponse.json({
      success: true,
      data: { items, total, page, pageSize: PAGE_SIZE, totalPages, regions },
    });
  } catch (error) {
    console.error('Failed to fetch presales:', error);
    logServerError(buildErrorLogMessage('GET /api/presales', error), '/api/presales', (error as Error)?.stack).catch(() => {});
    return NextResponse.json({ success: false, error: '분양정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
