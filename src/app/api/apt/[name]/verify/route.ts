import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// BUSAN_APARTMENT_SEARCH_COVERAGE_PERFORMANCE_V1 — 검색 결과 선택 → 상세 이동 전
// "이 이름+동 조합이 실제 데이터로 연결되는가"를 확인하던 기존 게이트
// (HomeApartmentSearch.tsx/ApartmentQuickSearch.tsx의 handleSelect)는
// `/api/apt/[name]?type=apt&period=12`를 호출했는데, 이 라우트는 캐시가 없으면
// 월별로 MOLIT 실거래 API를 최대 12회 순차 호출한다(실측: 첫 호출 5.4초) — 검색의
// 마지막 단계에서 외부 API가 사용자 대기 시간을 지배하는 구조였다.
//
// 이 게이트가 실제로 필요한 것은 "거래가 있는가/유닛 정보가 있는가"라는 존재 여부
// boolean 하나뿐이다. TRADE_HISTORY_DATA_V1 backfill + TRADE_CANCELLATION_RESYNC_V1로
// ApartmentTradeHistory가 이미 부산 실거래의 영구 저장본(취소 보정 완료)이므로,
// 그 안에서 identity(aptSeq 우선, 없으면 name+dong)로 존재만 확인하면 완전히 동일한
// boolean 계약을 DB-only, indexed lookup으로 대체할 수 있다 — 외부 API 호출 0회.
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const aptName = decodeURIComponent(name);
  const { searchParams } = new URL(request.url);
  const dong = searchParams.get('dong') || undefined;
  const aptSeq = searchParams.get('aptSeq') || undefined;

  if (!aptName) {
    return NextResponse.json({ hasTrades: false, hasUnitTypes: false }, { status: 400 });
  }

  const identityKey = aptSeq ? `id:${aptSeq}` : dong ? `nd:${aptName}|${dong}` : null;

  const [tradeRow, apartmentRow] = await Promise.all([
    identityKey
      ? prisma.apartmentTradeHistory.findFirst({
          where: { identityKey, dealType: 'sale' },
          select: { id: true },
        })
      : Promise.resolve(null),
    dong
      ? prisma.apartment.findUnique({
          where: { name_dong: { name: aptName, dong } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  let hasUnitTypes = false;
  if (apartmentRow) {
    const unitCount = await prisma.apartmentUnitType.count({ where: { apartmentId: apartmentRow.id } });
    hasUnitTypes = unitCount > 0;
  }

  return NextResponse.json({ hasTrades: !!tradeRow, hasUnitTypes });
}
