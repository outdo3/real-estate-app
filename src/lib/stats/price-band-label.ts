// REGIONAL_PRICE_COMPARISON_UX_V1.1 — 가격대 표기(클라이언트용, 서버 모듈을 끌어오지 않는다). 구간 정의는 sale-price-kpi.ts.

/** "1억원 미만" / "3억원대" / "12억원대". */
export function priceBandLabel(lowerEok: number): string {
  return lowerEok === 0 ? '1억원 미만' : `${lowerEok}억원대`;
}

/** 구간 범위 설명: "3억 이상 4억 미만". */
export function priceBandRangeText(lowerEok: number): string {
  return lowerEok === 0 ? '1억원 미만' : `${lowerEok}억 이상 ${lowerEok + 1}억 미만`;
}
