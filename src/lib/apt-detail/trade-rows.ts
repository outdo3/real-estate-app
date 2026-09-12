// APT_DETAIL_PARTNER_TRADE_DENSITY_V1 §13~§16 — 실거래 목록에서 **몇 줄을 보여줄지**만
// 정하는 순수 로직.
//
// 여기에 없는 것: 어떤 거래를 보여줄지에 대한 판단. 정렬, 취소 거래 제외, 평형 매칭,
// canonical aptSeq 범위, 가격 계산은 전부 이 파일 바깥에서 이미 끝나 있고 이 STEP에서
// 하나도 바뀌지 않았다(§15). 이 모듈은 이미 신뢰된 목록을 **앞에서부터 자를 뿐**이다.
//
// 왜 별도 모듈인가: 예전에는 개수 규칙이 컴포넌트 JSX 안에 흩어져 있어(초기값 15,
// 더보기 +15, 필터 변경 시 리셋) 테스트할 방법이 없었다. 규칙을 여기로 모아 개수
// 동작을 직접 검증한다.

/** 접힌 기본 상태에서 보여줄 행 수(§13). */
export const TRADE_ROWS_COLLAPSED = 5;

/**
 * 한 번 펼칠 때의 크기(§14).
 *
 * 예전 기본값과 같은 15다. "더보기"를 처음 누르면 예전에 처음부터 보이던 만큼
 * (15행)이 된다. 15보다 많은 거래가 있는 단지에서는 예전처럼 15씩 이어서 더 볼 수
 * 있다 — 밀도를 줄이면서 볼 수 있던 행을 잠가버리지 않는다.
 */
export const TRADE_ROWS_STEP = 15;

/** 앞에서부터 자른 목록. 신뢰된 순서를 그대로 유지한다. */
export function visibleTrades<T>(trades: readonly T[], visibleCount: number): T[] {
  return trades.slice(0, Math.max(0, visibleCount));
}

/** 더 볼 행이 남아 있는가. */
export function canExpandTrades(total: number, visibleCount: number): boolean {
  return total > visibleCount;
}

/** 접힌 기준보다 많이 펼쳐져 있는가. */
export function canCollapseTrades(visibleCount: number, collapsedCount: number = TRADE_ROWS_COLLAPSED): boolean {
  return visibleCount > collapsedCount;
}

/**
 * "더보기"를 눌렀을 때의 다음 개수.
 *
 * 5 → 15 (예전 기본값까지 한 번에), 그 뒤로는 15씩. 5에서 20으로 건너뛰지 않는 이유는
 * §14가 "현재 존재하는 최대치(15)까지 펼친다"를 요구하기 때문이다.
 */
export function nextVisibleCount(current: number): number {
  return current < TRADE_ROWS_STEP ? TRADE_ROWS_STEP : current + TRADE_ROWS_STEP;
}
