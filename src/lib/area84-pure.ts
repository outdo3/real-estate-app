// PERFORMANCE_V1_1_B — 84㎡ band/파생 필드 계산을 zero-import 순수 모듈로
// 분리한다. price-ranking.ts는 regional-feed.ts를 확장자 없이 상대 경로로
// import하는데(이 저장소 전반의 표준 스타일), 이 저장소의 `.test.mjs` 실행
// 방식(`node --experimental-strip-types --test`)은 확장자 없는 로컬 상대
// import를 해석하지 못한다(ERR_MODULE_NOT_FOUND) — Phase 2의
// peer-context-pure.ts/score-card-presenter.ts와 동일한, 이미 문서화된
// 제약이다. price-ranking.ts를 직접 고치는 대신(저장소 전체 스타일과
// 어긋남), 이 부분만 별도 zero-import 파일로 떼어 price-ranking.ts가
// 그대로 재사용(re-export)하게 한다 — 로직은 하나만 존재하고 갈라지지
// 않는다.

// §12 대표 거래 tie-break가 참조하는 exact area band. 거래의 exact raw
// area(예: 84.7855 vs 84.9950)는 절대 병합하지 않는다 — band는 "후보를
// 넓게 모으는" 용도일 뿐 identity가 아니다.
export const AREA84_BAND_MIN = 84;
export const AREA84_BAND_MAX = 85; // exclusive

export interface Area84Band {
  min: number;
  max: number;
}

export const DEFAULT_AREA84_BAND: Area84Band = { min: AREA84_BAND_MIN, max: AREA84_BAND_MAX };

export function isInArea84Band(area: number | null, band: Area84Band = DEFAULT_AREA84_BAND): boolean {
  return area != null && area >= band.min && area < band.max;
}

export interface Area84DerivedFields {
  previousAmount: number | null;
  previousDate: string | null;
  changeAmount: number | null;
  changePct: number | null;
  recent2yHighAmount: number;
  isRecent2yHigh: boolean;
  recent2yHighDeltaPct: number | null;
}

/** buildArea84RankingRows()(JS 경로, price-ranking.ts)와 sqlArea84RowToArea84Row()
 * (SQL pushdown 경로, price-rankings/route.ts) 양쪽이 공유하는 파생 필드 공식 —
 * 공식이 두 곳에서 따로 유지되며 갈라지는 것을 원천 차단한다. */
export function deriveArea84PriceFields(
  currentAmount: number,
  priorHighAmount: number | null,
  immediatePrior: { amount: number; date: string } | null
): Area84DerivedFields {
  const recent2yHighAmount = priorHighAmount != null && priorHighAmount > currentAmount ? priorHighAmount : currentAmount;
  const isRecent2yHigh = recent2yHighAmount === currentAmount;
  return {
    previousAmount: immediatePrior?.amount ?? null,
    previousDate: immediatePrior?.date ?? null,
    changeAmount: immediatePrior ? currentAmount - immediatePrior.amount : null,
    changePct: immediatePrior && immediatePrior.amount > 0 ? Math.round(((currentAmount - immediatePrior.amount) / immediatePrior.amount) * 1000) / 10 : null,
    recent2yHighAmount,
    isRecent2yHigh,
    recent2yHighDeltaPct: isRecent2yHigh ? null : Math.round(((currentAmount - recent2yHighAmount) / recent2yHighAmount) * 1000) / 10,
  };
}
