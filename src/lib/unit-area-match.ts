// APT DETAIL UNIT/TRADE FILTER BUG V1 — 상세페이지 "선택 평형 → 거래 데이터"의
// **단일 계약**.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────
// 상세페이지에는 같은 면적이 두 가지 문자열 도메인으로 존재한다:
//
//   Unit Master canonicalExclusiveArea : "129.7178"     (bare, apartment_unit_types)
//   실거래 trade.area                  : "129.7178m²"   (api-molit.ts:217이 붙인 suffix)
//
// 예전에는 이 둘을 문자열 === 로 비교했다. 절대 일치하지 않으므로 Unit Master가 있는
// 단지에서는 평형 칩을 눌러도 거래 데이터가 하나도 안 걸렸고, 그 결과 칩만 활성화되고
// Hero/타임라인/최고최저/차트는 기본 평형(84㎡)에 그대로 머물렀다.
// (실측: 대신롯데캐슬 26140-1164 — 50평 칩을 눌러도 84.79㎡ 3.87억이 유지됨)
//
// ── 규칙 ──────────────────────────────────────────────────────────────────
// 새 허용치를 만들지 않는다. 이미 production에서 같은 두 도메인을 잇는 데 쓰고 있는
// statistics-pyeong-resolver.ts의 AREA_MATCH_EPSILON(0.001)을 그대로 재사용한다.
// 그 상수는 84.7855 vs 84.9950, 59.8826 vs 59.8839 같은 실존 micro-variant가 서로
// 병합되지 않도록 이미 검증돼 있다(둘의 간격은 epsilon보다 훨씬 크다).
//
// 이 매칭은 **숫자 비교**라 문자열 포맷에 무관하다. 따라서 선택값이
// Unit Master canonical("129.7178")이든 raw trade.area("129.7178m²")이든
// 똑같이 동작한다 — 소비자가 어느 도메인을 들고 있는지 신경 쓸 필요가 없어진다.
//
// 하지 않는 것:
//   - 평 라벨을 여기서 만들지 않는다(area-utils.ts 담당).
//   - 반올림/근접 병합을 하지 않는다. epsilon은 Decimal↔float 왕복 오차 흡수용이다.
//   - 선택 평형에 거래가 없을 때 다른 평형으로 대체하지 않는다(호출부가 빈 배열을 받는다).

import { AREA_MATCH_EPSILON } from './statistics-pyeong-resolver';

/** 평형 선택 없음(= 전체 평형)을 뜻하는 sentinel. 기존 UI 문자열을 그대로 쓴다. */
export const ALL_AREAS = '전체';

export { AREA_MATCH_EPSILON };

/**
 * "129.7178m²" / "129.7178" / "129.7178㎡" → 129.7178
 * 숫자로 해석할 수 없으면 null(0으로 대체하지 않는다 — 0㎡는 거짓 면적이다).
 */
export function parseAreaM2(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === ALL_AREAS) return null;
  // 선행 숫자만 취한다. "84.7855m²" → "84.7855"
  const m = trimmed.match(/^-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** 선택값이 "전체 평형"인가. */
export function isAllAreas(selected: string | null | undefined): boolean {
  return !selected || selected === ALL_AREAS;
}

/**
 * 이 거래가 선택된 평형에 속하는가.
 *
 * 전체 선택이면 항상 true. 어느 한쪽이라도 숫자로 해석되지 않으면 **false**다 —
 * 해석 실패를 "일치"로 처리하면 다른 평형 거래가 섞여 들어온다(이 버그의 원형).
 */
export function areaMatchesSelection(
  tradeArea: string | number | null | undefined,
  selected: string | null | undefined
): boolean {
  if (isAllAreas(selected)) return true;
  const a = parseAreaM2(tradeArea);
  const b = parseAreaM2(selected);
  if (a == null || b == null) return false;
  return Math.abs(a - b) < AREA_MATCH_EPSILON;
}

/**
 * 선택 평형에 해당하는 거래만 남긴다. 순서는 입력 순서를 그대로 보존한다
 * (호출부가 이미 최신순 정렬을 보장하고 있고, [0]을 최신 거래로 쓴다).
 *
 * 선택 평형에 거래가 없으면 **빈 배열**이다. 다른 평형으로 fallback하지 않는다.
 */
export function selectTradesForArea<T extends { area: string }>(
  trades: readonly T[],
  selected: string | null | undefined
): T[] {
  if (isAllAreas(selected)) return [...trades];
  return trades.filter((t) => areaMatchesSelection(t.area, selected));
}

/**
 * 선택/거래 면적에 해당하는 Unit Master 항목을 찾는다.
 * 라벨(평형 표기)을 붙이는 용도 — 없으면 null이고, 호출부는 raw ㎡로 표시한다.
 */
export function findUnitForArea<T extends { canonicalExclusiveArea: string }>(
  units: readonly T[] | null | undefined,
  area: string | number | null | undefined
): T | null {
  if (!units || units.length === 0) return null;
  const target = parseAreaM2(area);
  if (target == null) return null;
  return (
    units.find((u) => {
      const c = parseAreaM2(u.canonicalExclusiveArea);
      return c != null && Math.abs(c - target) < AREA_MATCH_EPSILON;
    }) ?? null
  );
}

/**
 * 각 평형(칩)에 해당하는 거래 건수. 칩 값이 Unit Master canonical이어도
 * raw trade.area와 숫자로 매칭되므로 0건으로 표시되지 않는다.
 */
export function countTradesByArea(
  trades: readonly { area: string }[],
  areas: readonly string[]
): Map<string, number> {
  const result = new Map<string, number>();
  for (const area of areas) {
    result.set(area, trades.reduce((n, t) => (areaMatchesSelection(t.area, area) ? n + 1 : n), 0));
  }
  return result;
}
