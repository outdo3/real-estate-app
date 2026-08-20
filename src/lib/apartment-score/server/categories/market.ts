import type { MarketInfo, RawMarketFeature } from '../types';
import { MIN_TRANSACTION_SAMPLE } from '../config';

/**
 * §6/§18 사용자 승인: Market은 Core Score에 전혀 반영하지 않는다(weight 0,
 * informational-only). "가격 자체가 좋음/나쁨"을 절대 판단하지 않는다 — 오직 거래
 * 활성도(유동성의 간접지표)만, 그것도 최소표본(§30, 3건) 이상일 때만 서술한다.
 * transactionCount12m==1인 aptSeq가 서구 33.8%/해운대 17.6%라 이 게이팅이 필수.
 */
export function computeMarketInfo(market: RawMarketFeature | null): MarketInfo {
  if (!market || market.transactionCount12m == null) {
    return { status: 'NO_DATA', transactionCount12m: null, medianPricePerM2_12m: null, activityLabel: null };
  }

  if (market.transactionCount12m < MIN_TRANSACTION_SAMPLE) {
    return {
      status: 'LOW_SAMPLE',
      transactionCount12m: market.transactionCount12m,
      medianPricePerM2_12m: market.medianPricePerM2_12m,
      activityLabel: null, // 표본 부족 — "활발/한산" 같은 활동성 서술 자체를 만들지 않는다
    };
  }

  return {
    status: 'AVAILABLE',
    transactionCount12m: market.transactionCount12m,
    medianPricePerM2_12m: market.medianPricePerM2_12m,
    activityLabel: `최근 12개월간 ${market.transactionCount12m}건 거래되어 비교 단지 대비 거래 정보를 확인할 수 있습니다.`,
  };
}
