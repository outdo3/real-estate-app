// REGIONAL_PRICE_COMPARISON_UX_V1.1 — 통계 거래량 화면 상단 매매 KPI(많이 거래된 가격대 · ㎡당 중앙가격). 순수 함수.
//
// - 유효(취소 아님) 매매 행 하나 = 한 건. 내용 dedupe 없음(TOP_COMPLEX_AGGREGATION_TRUST_AUDIT_V1).
// - 가격대는 **1억원 균일 구간**(0~1억 미만, 1억대, 2억대 …). 고가 구간을 넓게 묶지 않는다 — 부산 실측
//   (2026-09-19)에서 10~15억처럼 넓은 구간은 폭이 넓다는 이유만으로 최빈 구간이 된다(수영구 30일:
//   10~15억 합 17건 > 5억대 12건). 폭이 다른 구간끼리의 "가장 많이"는 오해를 만든다.
// - 최다 구간이 여럿이면 하나를 임의로 고르지 않고 모두 돌려준다(서구 15일: 3억대 = 4억대 = 7건).
// - ㎡당은 한장 브리핑과 **같은 계산**(거래별 금액÷전용면적의 중앙값, region-aggregate `median`) — 라벨은 "중앙가격".

import { median } from '../report/region-aggregate';

/** 가격대 구간 폭(만원). 1억원. */
export const PRICE_BAND_WIDTH_MANWON = 10000;

export interface SaleKpiTrade {
  dealAmount: number;
  excluUseArea: number | null;
  dealDate: string;
  dealCanceled: boolean;
}

export interface PriceBand {
  /** 구간 하한(억). 0이면 1억원 미만. */
  lowerEok: number;
  count: number;
}

export interface SalePriceKpi {
  /** 기간 안 유효 매매 건수 = bands 합계. */
  count: number;
  /** 거래가 있는 구간만, 하한 오름차순. */
  bands: PriceBand[];
  /** 가장 많이 거래된 구간(동률이면 모두, 하한 오름차순). 거래가 없으면 []. */
  topBands: PriceBand[];
  /** ㎡당 중앙가격(만원/㎡, 소수 1자리 — 브리핑과 같은 반올림). 면적 유효 거래가 없으면 null. */
  medianPricePerM2: number | null;
}

export function priceBandOf(dealAmount: number): number {
  return Math.floor(dealAmount / PRICE_BAND_WIDTH_MANWON);
}

export function buildSalePriceKpi(trades: readonly SaleKpiTrade[], range: { from: string; to: string }): SalePriceKpi {
  const byBand = new Map<number, number>();
  const perM2: number[] = [];
  let count = 0;
  for (const t of trades) {
    if (t.dealCanceled || !(t.dealAmount > 0)) continue;
    if (t.dealDate < range.from || t.dealDate > range.to) continue;
    count++;
    const b = priceBandOf(t.dealAmount);
    byBand.set(b, (byBand.get(b) ?? 0) + 1);
    if (t.excluUseArea != null && t.excluUseArea > 0) perM2.push(t.dealAmount / t.excluUseArea);
  }
  const bands = [...byBand.entries()].sort((a, b) => a[0] - b[0]).map(([lowerEok, n]) => ({ lowerEok, count: n }));
  const max = bands.reduce((m, b) => Math.max(m, b.count), 0);
  const med = median(perM2);
  return {
    count,
    bands,
    topBands: max > 0 ? bands.filter((b) => b.count === max) : [],
    medianPricePerM2: med == null ? null : Math.round(med * 10) / 10,
  };
}
