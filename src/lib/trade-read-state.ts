export interface TradeReadPayload<T> {
  trades?: T[];
  apiError?: string | null;
  // APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX — 요청한 월 중 일부만 실패했을 때 서버가
  // 내려주는 필드(통계 라우트의 partial/failedDistricts와 같은 의미, 셀 단위만 월).
  // 예전 응답에는 없을 수 있으므로 optional로 둔다.
  partial?: boolean;
  failedMonths?: string[];
}

export interface TradeReadState<T> {
  trades: T[];
  apiError: string | null;
  /** 요청한 기간 중 일부(또는 전부)를 불러오지 못함 — 집계를 완전한 값으로 제시하면 안 된다. */
  partial: boolean;
  /** 화면에 그대로 쓸 수 있는 안내 문구. 완전한 결과면 null. */
  incompleteMessage: string | null;
}

export const TRADE_API_UNAVAILABLE_MESSAGE = '실거래가 API 요청에 실패했습니다.';

// 사용자에게 보여줄 문구. 원본 오류 메시지(예: "초당 서비스 요청제한 횟수 초과 에러")를
// 그대로 노출하지 않고, "거래 없음"이라고 말하지도 않는다.
export const TRADE_PARTIAL_MESSAGE = '일부 기간의 거래 정보를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.';

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
  };
}
