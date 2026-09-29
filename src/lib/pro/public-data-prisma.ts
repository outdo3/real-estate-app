// REALTOR_PRO_MVP_V1 — 이집 공공 데이터 prefill(읽기 전용). aptSeq로만 조회 — 이름 재식별 없음.
//
// · 단지 기본 정보(ApartmentMaster)는 중개사 입력 보조용으로 항상 읽는다(공개 노출 아님).
// · 실거래는 getRegionEnablement(lawdCd).detail이 열린 지역만 — Pro는 공개 게이트의 예외가 아니다.
// · 조회 실패는 "거래 없음"으로 위장하지 않는다(UNAVAILABLE). 성공한 0건만 VERIFIED_ZERO.
// · 면적 선택지는 실거래 원본 전용면적(정확값)만 — 평형 환산·공급면적 추정 없음.
// · 외부 API(MOLIT 등) 호출 없음. 커넥션 1개 환경이라 순차 쿼리.

import { prisma } from '@/lib/prisma';
import { getRegionEnablement } from '@/lib/region/enablement';
import type { PublicAptDataSource } from './service-core';
import type { PublicAptInfo, PublicTradePoint } from './types';
import { APT_SEQ_PATTERN } from './rules';

const RECENT_TRADES = 10;
const TRADE_WINDOW_DAYS = 365 * 2;

export const prismaPublicAptData: PublicAptDataSource = {
  async lookup(aptSeq: string): Promise<PublicAptInfo | null> {
    if (!APT_SEQ_PATTERN.test(aptSeq)) return null;
    const m = await prisma.apartmentMaster.findUnique({
      where: { aptSeq },
      select: { aptSeq: true, name: true, sggCd: true, umdName: true, roadAddress: true, buildYear: true, totalHouseholds: true, parkingCount: true, latitude: true, longitude: true },
    });
    if (!m || !m.aptSeq) return null;
    const lawdCd = m.sggCd ?? aptSeq.slice(0, 5);
    const detailOpen = getRegionEnablement(lawdCd).detail;
    const now = new Date();
    const base: PublicAptInfo = {
      aptSeq: m.aptSeq,
      name: m.name,
      lawdCd,
      umdName: m.umdName,
      roadAddress: m.roadAddress,
      buildYear: m.buildYear,
      totalHouseholds: m.totalHouseholds,
      parkingCount: m.parkingCount,
      lat: m.latitude,
      lng: m.longitude,
      detailOpen,
      tradeState: detailOpen ? 'UNAVAILABLE' : 'REGION_NOT_OPEN',
      recentTrades: [],
      areaOptionsM2: [],
      dataAsOf: now,
    };
    if (!detailOpen) return base;
    try {
      const since = new Date(now.getTime() - TRADE_WINDOW_DAYS * 86_400_000);
      const rows = await prisma.apartmentTradeHistory.findMany({
        where: { aptSeq, dealCanceled: false, dealDate: { gte: since } },
        orderBy: { dealDate: 'desc' },
        take: RECENT_TRADES,
        select: { dealDate: true, dealAmount: true, exclusiveArea: true, floor: true },
      });
      const trades: PublicTradePoint[] = rows.map((r) => ({
        dealDate: r.dealDate.toISOString().slice(0, 10),
        priceManwon: Number(r.dealAmount),
        exclusiveAreaM2: Number(r.exclusiveArea),
        floor: r.floor,
      }));
      const areas = await prisma.apartmentTradeHistory.findMany({ where: { aptSeq }, distinct: ['exclusiveArea'], select: { exclusiveArea: true }, take: 30 });
      return {
        ...base,
        tradeState: trades.length ? 'OK' : 'VERIFIED_ZERO',
        recentTrades: trades,
        areaOptionsM2: [...new Set(areas.map((a) => Number(a.exclusiveArea)))].sort((a, b) => a - b),
      };
    } catch {
      return base; // UNAVAILABLE — 실패를 0건으로 보이지 않는다
    }
  },
};
