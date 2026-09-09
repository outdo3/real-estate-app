// PERCEIVED_PERFORMANCE_V2_DATAFLOW §6 — 넓은 창(period=60) 응답 하나에서 좁은 창
// (12/36개월) view를 파생한다.
//
// 왜 필요한가(감사 V1 §5.1 실측): 상세페이지가 **같은 엔드포인트를 서로 겹치는 기간으로
// 5회** 호출했다 — parent(period=12), PriceTrendChart(apt/rent 36), InvestmentMetrics
// (apt/rent 60). `period=12 ⊂ 36 ⊂ 60`이라 60개월 응답은 나머지의 상위집합이고, 상세
// XHR 디코딩 합계 465KB의 대부분이 이 중복이었다.
//
// **이 모듈의 존재 이유는 성능이 아니라 신뢰다.** 60개월 응답을 그냥 잘라 쓰면
// 완전성 메타데이터(partial/failedMonths/monthsRequested/monthsSucceeded)가 60개월
// 요청을 설명하는 값이라 좁은 창에 그대로 붙이면 양방향으로 거짓이 된다:
//   - 실패한 달이 좁은 창 **밖**에 있는데 "이 기간 일부를 못 불러왔다"고 말하거나,
//   - 실패한 달이 좁은 창 **안**에 있는데 그 사실이 묻히거나.
// 그래서 자르는 것과 함께 완전성을 그 창 기준으로 **다시 계산**한다. failedMonths가
// YYYYMM 목록이라 이 재계산은 추정이 아니라 정확한 교집합 연산이다.
//
// 절대 하지 않는 것:
//   - 실패를 0건으로 접기 (FAILED != ZERO)
//   - 서버가 준 것보다 더 완전하다고 주장하기
//   - 없는 달을 성공한 달로 세기
import {
  TRADE_API_UNAVAILABLE_MESSAGE,
  TRADE_PARTIAL_MESSAGE,
  type TradeReadState,
} from './trade-read-state';

/**
 * `/api/apt/[name]`이 period로부터 월 목록을 만드는 규칙을 그대로 옮긴 것이다
 * (route.ts: `new Date(now.getFullYear(), now.getMonth() - i, 1)` → YYYYMM, 최신순).
 * 두 곳이 갈라지면 완전성 재계산이 조용히 어긋나므로 규칙을 바꿀 때는 반드시 같이 바꾼다.
 */
export function monthsForPeriod(period: number, now: Date = new Date()): string[] {
  const months: string[] = [];
  for (let i = 0; i < period; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/** 거래의 `tradeDate`("YYYY-MM-DD", api-molit.ts가 만드는 형식) → "YYYYMM". */
export function tradeMonthKey(tradeDate: unknown): string | null {
  if (typeof tradeDate !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(tradeDate.trim());
  return m ? `${m[1]}${m[2]}` : null;
}

interface DatedTrade {
  tradeDate?: string;
}

/**
 * 넓은 창 read state를 좁은 창 read state로 좁힌다.
 *
 * - `targetPeriod >= sourcePeriod`이면 원본을 그대로 돌려준다(가장 넓은 view는 손실 없음).
 * - 원본이 전체 실패(apiError)면 좁혀도 전체 실패다 — 그대로 돌려준다.
 * - 그 외에는 거래를 대상 창의 월로 거르고 완전성을 그 창 기준으로 다시 센다.
 *
 * 시계 어긋남 방어: 클라이언트가 계산한 원본 창 길이(`sourcePeriod`)와 서버가 실제로
 * 요청했다고 보고한 `monthsRequested`가 다르면(월 경계에서의 시계 차, 구버전 응답 등)
 * 완전성을 **다시 계산하지 않고 원본 값을 그대로 유지**한다. 이 방향의 오차는 항상
 * "서버가 말한 것보다 더 완전하다고 말하지 않는" 쪽이라 안전하다.
 */
export function narrowTradeWindow<T extends DatedTrade>(
  source: TradeReadState<T>,
  sourcePeriod: number,
  targetPeriod: number,
  now: Date = new Date(),
): TradeReadState<T> {
  if (targetPeriod >= sourcePeriod) return source;
  if (source.apiError) return source;

  // 대상 창은 원본 창의 **접두부**로 잡는다(같은 시계로 만든 같은 목록에서 잘라내므로
  // 두 목록이 서로 어긋날 수 없다).
  const sourceMonths = monthsForPeriod(sourcePeriod, now);
  const targetMonths = sourceMonths.slice(0, targetPeriod);
  const windowSet = new Set(targetMonths);

  const trades = source.trades.filter((trade) => {
    const key = tradeMonthKey(trade?.tradeDate);
    // 월을 읽을 수 없는 거래는 좁은 창에 넣지 않는다 — 어느 달인지 모르는 값을 특정
    // 기간의 거래라고 주장할 수는 없다. 가장 넓은 view(위 early return)에는 그대로 남는다.
    return key !== null && windowSet.has(key);
  });

  // 서버 완전성 메타데이터를 신뢰할 수 없으면 재계산하지 않는다(0 = "모른다",
  // trade-read-state.ts 계약).
  if (source.monthsRequested !== sourcePeriod) {
    return { ...source, trades };
  }

  const failedMonths = source.failedMonths.filter((month) => windowSet.has(month));
  const allFailed = targetMonths.length > 0 && failedMonths.length === targetMonths.length;

  if (allFailed) {
    // 대상 창의 모든 달이 실패 — 실제로 그 period를 요청했다면 서버가 apiError로
    // 답했을 상태다. 거래 0건을 "거래가 없다"로 보여주면 안 되는 바로 그 경우다.
    return {
      trades: [],
      apiError: TRADE_API_UNAVAILABLE_MESSAGE,
      partial: false,
      incompleteMessage: TRADE_API_UNAVAILABLE_MESSAGE,
      failedMonths,
      monthsRequested: targetMonths.length,
      monthsSucceeded: 0,
    };
  }

  const partial = failedMonths.length > 0;
  return {
    trades,
    apiError: null,
    partial,
    incompleteMessage: partial ? TRADE_PARTIAL_MESSAGE : null,
    failedMonths,
    monthsRequested: targetMonths.length,
    monthsSucceeded: targetMonths.length - failedMonths.length,
  };
}
