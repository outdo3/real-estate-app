export interface TradeReadPayload<T> {
  trades?: T[];
  apiError?: string | null;
  // APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX — 요청한 월 중 일부만 실패했을 때 서버가
  // 내려주는 필드(통계 라우트의 partial/failedDistricts와 같은 의미, 셀 단위만 월).
  // 예전 응답에는 없을 수 있으므로 optional로 둔다.
  partial?: boolean;
  failedMonths?: string[];
  // MOLIT_PARTIAL_TRUST_V2 §6 — /api/apt/[name]는 이미 이 두 값을 내려주고 있었지만
  // 클라이언트 계약에는 빠져 있어, 파생 지표 소비자가 "얼마나 빠졌는지"를 알 수 없었다.
  monthsRequested?: number;
  monthsSucceeded?: number;
}

export interface TradeReadState<T> {
  trades: T[];
  apiError: string | null;
  /** 요청한 기간 중 일부(또는 전부)를 불러오지 못함 — 집계를 완전한 값으로 제시하면 안 된다. */
  partial: boolean;
  /** 화면에 그대로 쓸 수 있는 안내 문구. 완전한 결과면 null. */
  incompleteMessage: string | null;
  // MOLIT_PARTIAL_TRUST_V2 §6 — 서버 응답의 완전성 메타데이터를 그대로 실어 나른다.
  // 예전 응답(필드 없음)이면 failedMonths=[], monthsRequested/Succeeded=0으로 둔다 —
  // 0은 "모른다"는 뜻이고, 신뢰 판정 자체는 위의 partial/apiError만으로 내린다.
  failedMonths: string[];
  monthsRequested: number;
  monthsSucceeded: number;
}

export const TRADE_API_UNAVAILABLE_MESSAGE = '실거래가 API 요청에 실패했습니다.';

// 사용자에게 보여줄 문구. 원본 오류 메시지(예: "초당 서비스 요청제한 횟수 초과 에러")를
// 그대로 노출하지 않고, "거래 없음"이라고 말하지도 않는다.
export const TRADE_PARTIAL_MESSAGE = '일부 기간의 거래 정보를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.';

// MOLIT_PARTIAL_TRUST_V2 §7 — 파생 지표(전세가율/갭/비교 등)를 아예 계산하지 않고
// 숨길 때 쓰는 문구. "데이터 부족"(=진짜로 거래가 없음)과 반드시 구분되어야 한다.
export const TRADE_DERIVED_SUPPRESSED_MESSAGE = '일부 기간의 데이터가 없어 현재 계산할 수 없습니다.';

export function resolveTradeReadState<T>(
  responseOk: boolean,
  payload?: TradeReadPayload<T> | null,
): TradeReadState<T> {
  if (!responseOk || !payload) {
    return {
      trades: [],
      apiError: TRADE_API_UNAVAILABLE_MESSAGE,
      partial: false,
      incompleteMessage: TRADE_API_UNAVAILABLE_MESSAGE,
      failedMonths: [],
      monthsRequested: 0,
      monthsSucceeded: 0,
    };
  }

  const apiError = payload.apiError || null;
  // 전체 실패(apiError)와 일부 실패(partial)를 모두 "불완전"으로 다루되, 문구는 구분한다.
  const partial = apiError ? false : !!payload.partial;

  return {
    trades: Array.isArray(payload.trades) ? payload.trades : [],
    apiError,
    partial,
    incompleteMessage: apiError ? TRADE_API_UNAVAILABLE_MESSAGE : partial ? TRADE_PARTIAL_MESSAGE : null,
    failedMonths: Array.isArray(payload.failedMonths) ? payload.failedMonths : [],
    monthsRequested: typeof payload.monthsRequested === 'number' ? payload.monthsRequested : 0,
    monthsSucceeded: typeof payload.monthsSucceeded === 'number' ? payload.monthsSucceeded : 0,
  };
}

// ── MOLIT_PARTIAL_TRUST_V2 §3/§5 — 파생 지표 신뢰 판정 ────────────────────────
//
// 원본이 불완전(partial 또는 apiError)하면 그 원본에서 나온 파생값은 "검증된 값"이
// 아니다. 다만 불완전성의 영향은 지표 종류마다 다르다:
//
//  - 관측 사실 그 자체(예: "이 가격에 실제로 거래된 건이 있다")는 빠진 달이 있어도
//    거짓이 되지 않는다 — 다만 "가장 최근"이라는 단정이 흔들리므로 단서를 붙인다.
//  - 두 계열을 결합한 계산값(전세가율 = 전세/매매, 갭 = 매매-전세)은 어느 한쪽에서
//    한 달만 빠져도 값 자체가 달라질 수 있다 — 숫자를 보여주면 안 된다.
//
// 이 판정을 각 컴포넌트가 제각기 다시 구현하면 완전성 계약이 갈라지므로(§6 "하나의
// 공유 계약") 여기 한 곳에만 둔다.
export type DerivedMetricTrust =
  /** 원본이 완전 — 기존과 100% 동일하게 값 그대로 노출한다. */
  | 'SAFE'
  /** 원본이 불완전하지만 값 자체는 실제 관측치 — 값 + 단서를 함께 보여준다. */
  | 'QUALIFIED'
  /** 원본이 불완전하고 결합 계산값 — 숫자를 만들지 않고 숨긴다. */
  | 'SUPPRESSED';

/** 원본 하나라도 불완전하면 true. 여러 계열(매매+전월세)을 함께 쓰는 지표용. */
export function isAnySourceIncomplete(
  ...states: Array<Pick<TradeReadState<unknown>, 'partial' | 'apiError'> | null | undefined>
): boolean {
  return states.some((s) => !!s && (s.partial || !!s.apiError));
}

/**
 * 결합 계산값(전세가율/갭 등)의 신뢰 상태. 원본이 하나라도 불완전하면 SUPPRESSED.
 * 완전하면 SAFE — 완전 데이터 경로의 동작/값은 한 글자도 바뀌지 않는다(§8).
 */
export function resolveDerivedMetricTrust(
  ...states: Array<Pick<TradeReadState<unknown>, 'partial' | 'apiError'> | null | undefined>
): DerivedMetricTrust {
  return isAnySourceIncomplete(...states) ? 'SUPPRESSED' : 'SAFE';
}

/**
 * 관측 사실(최근 실거래가 등)의 신뢰 상태. 원본이 불완전하면 QUALIFIED —
 * 값은 실제 거래이므로 지우지 않되 "완전한 최신값"으로 단정하지 않는다.
 */
export function resolveObservedMetricTrust(
  ...states: Array<Pick<TradeReadState<unknown>, 'partial' | 'apiError'> | null | undefined>
): DerivedMetricTrust {
  return isAnySourceIncomplete(...states) ? 'QUALIFIED' : 'SAFE';
}
