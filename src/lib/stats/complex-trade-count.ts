// TOP_COMPLEX_AGGREGATION_FIX_V1 — "거래 많은 단지"의 **공용 집계 규칙**.
//
// 의미: 선택 기간의 **유효(취소 아님) 매매 계약 기록 수**. 원천(국토교통부 실거래 공개)이 발행한
// 유효 기록 하나가 한 건이다. DB 행은 자연키(+occurrenceIndex)로 원천 기록과 1:1이다
// (TOP_COMPLEX_AGGREGATION_TRUST_AUDIT_V1 §3 — DB 행 > 원천 행인 그룹 0).
//
// 하지 않는 것:
//   - (금액·계약일·층·면적)이 같다고 접지 않는다. 같은 날 같은 층·같은 금액의 **다른 세대** 거래가
//     원천에 실재한다(대운스카이뷰1차 30일: 원천 46기록 — 예전 화면은 16으로 접었다).
//   - 취소 행과 유효 행을 먼저 합치지 않는다. 취소는 **먼저** 빼고 센다 — 합친 뒤 빼면
//     남은 행이 취소일 때 유효 거래까지 사라진다.
//
// 화면(/api/stats/concentration → buildConcentrationRanking)과 한장 브리핑(representativeComplexes)이
// 이 함수 하나로 센다. 정렬·표시 규칙은 각 호출부 그대로다.

/**
 * 단지별 유효 거래 행을 모은다. 입력 순서를 보존한다(호출부의 "최근 거래" 판단·기존 동률 순서가
 * 입력 순서에 기대는 경우가 있다). 취소 행은 버린다.
 */
export function groupValidTradesByComplex<T>(
  rows: readonly T[],
  complexKeyOf: (row: T) => string,
  isCanceled: (row: T) => boolean
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    if (isCanceled(r)) continue;
    const key = complexKeyOf(r);
    const list = out.get(key);
    if (list) list.push(r);
    else out.set(key, [r]);
  }
  return out;
}

/** 단지별 유효 거래 수. */
export function countValidTradesByComplex<T>(
  rows: readonly T[],
  complexKeyOf: (row: T) => string,
  isCanceled: (row: T) => boolean
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, list] of groupValidTradesByComplex(rows, complexKeyOf, isCanceled)) out.set(k, list.length);
  return out;
}
