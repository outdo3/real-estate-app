export interface TradeReadPayload<T> {
  trades?: T[];
  apiError?: string | null;
}

export interface TradeReadState<T> {
  trades: T[];
  apiError: string | null;
}

export const TRADE_API_UNAVAILABLE_MESSAGE = '실거래가 API 요청에 실패했습니다.';

export function resolveTradeReadState<T>(
  responseOk: boolean,
  payload?: TradeReadPayload<T> | null,
): TradeReadState<T> {
  if (!responseOk || !payload) {
    return { trades: [], apiError: TRADE_API_UNAVAILABLE_MESSAGE };
  }

  return {
    trades: Array.isArray(payload.trades) ? payload.trades : [],
    apiError: payload.apiError || null,
  };
}
