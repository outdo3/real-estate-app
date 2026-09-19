// REGIONAL_PRICE_COMPARISON_V1 — 하위 지역(부산 → 구·군, 구 → 법정동)별 **평균 매매가격** 비교. 순수 함수.
//
// 의미: 선택한 기간 동안 그 하위 지역에서 실제로 거래된 아파트의 **평균 매매가격**(거래금액의 산술평균).
//   - 유효(취소 아님) 매매 행 하나 = 한 건. 금액·날짜·층·면적이 같다고 접지 않는다
//     (TOP_COMPLEX_AGGREGATION_TRUST_AUDIT_V1 — 같은 조건의 서로 다른 세대 거래가 원천에 실재한다).
//   - 취소는 먼저 뺀다. false-cancel 28행·결함 B는 DB 상태 그대로다(이번 STEP에서 고치지 않는다).
//   - 거래가 없는 지역은 평균을 만들지 않는다(null) — 0원을 평균으로 보여주지 않는다.
//   - 지역 identity는 lawdCd(구) / 그 구의 dong(원천 법정동 umdNm). 행정동을 추정하지 않는다.
//
// 거래량 요약(dashboard volumeSummaryByPeriod)과 **같은 행 집합**에서 계산하므로 하위 지역 건수 합계는
// 상위 지역 매매 거래건수와 같다(분류 안 된 행은 `unclassifiedCount`로 따로 보고한다).

/** 표본이 적다고 표시할 기준(미만). 부산 실측(2026-09-19): 동 단위는 30일에도 1건·2~4건 동이 흔하다 — 숨기지 않고 표시만 한다. */
export const REGION_PRICE_LOW_SAMPLE_BELOW = 5;

export interface RegionPriceTrade {
  lawdCd: string;
  dong: string | null;
  dealAmount: number;
  excluUseArea: number | null;
  dealDate: string;
  dealCanceled: boolean;
}

export interface RegionPriceRow {
  key: string;
  name: string;
  /** 기간 안 유효 매매 건수. 0이면 가격은 null. */
  count: number;
  /** 평균 매매가격(만원, 반올림). 거래가 없으면 null. */
  avgAmount: number | null;
  /** ㎡당 평균가(만원/㎡, 소수 1자리) — 면적이 유효한 거래의 (금액÷전용면적) 평균. 없으면 null. */
  avgPricePerM2: number | null;
  lowSample: boolean;
}

export interface RegionPriceComparison {
  level: 'district' | 'dong';
  rows: RegionPriceRow[];
  /** 하위 지역 건수 합계 — 상위 매매 거래건수와 대조용. */
  totalCount: number;
  /** 하위 지역을 정할 수 없어 목록에 넣지 못한 유효 거래(구 목록 밖 lawdCd·동 정보 없음). */
  unclassifiedCount: number;
}

/**
 * @param trades   이미 선택 기간으로 자른 행이 아니어도 된다 — range로 다시 자른다.
 * @param universe 표시할 하위 지역(거래가 없어도 "거래 없음"으로 남는다). 순서는 결과 정렬로 대체된다.
 */
export function buildRegionPriceComparison(
  trades: readonly RegionPriceTrade[],
  level: 'district' | 'dong',
  universe: readonly { key: string; name: string }[],
  range: { from: string; to: string }
): RegionPriceComparison {
  const known = new Map(universe.map((u) => [u.key, u.name]));
  const acc = new Map<string, { count: number; sum: number; ppmSum: number; ppmN: number }>();
  for (const u of universe) acc.set(u.key, { count: 0, sum: 0, ppmSum: 0, ppmN: 0 });
  let unclassifiedCount = 0;

  for (const t of trades) {
    if (t.dealCanceled || !(t.dealAmount > 0)) continue;
    if (t.dealDate < range.from || t.dealDate > range.to) continue;
    const key = level === 'district' ? t.lawdCd : (t.dong ?? '').trim();
    if (!key || !known.has(key)) {
      unclassifiedCount++;
      continue;
    }
    const a = acc.get(key)!;
    a.count++;
    a.sum += t.dealAmount;
    if (t.excluUseArea != null && t.excluUseArea > 0) {
      a.ppmSum += t.dealAmount / t.excluUseArea;
      a.ppmN++;
    }
  }

  const rows: RegionPriceRow[] = [...acc.entries()].map(([key, a]) => ({
    key,
    name: known.get(key)!,
    count: a.count,
    avgAmount: a.count > 0 ? Math.round(a.sum / a.count) : null,
    avgPricePerM2: a.ppmN > 0 ? Math.round((a.ppmSum / a.ppmN) * 10) / 10 : null,
    lowSample: a.count > 0 && a.count < REGION_PRICE_LOW_SAMPLE_BELOW,
  }));

  // 정렬(UX V1.1 — 그룹 B): 표본 충분(5건 이상) → 표본 적음(1~4건) → 거래 없음 순으로 묶고,
  // 각 묶음 안에서 평균 매매가격 높은 순 → 거래건수 많은 순 → 지역명. 1건짜리 지역이 평균 1위로 올라와
  // 대표값처럼 보이는 것을 막는다. 어떤 지역도 빼지 않고 가격도 바꾸지 않는다.
  const tier = (r: RegionPriceRow) => (r.avgAmount == null ? 2 : r.lowSample ? 1 : 0);
  rows.sort((x, y) => {
    if (tier(x) !== tier(y)) return tier(x) - tier(y);
    if (x.avgAmount != null && y.avgAmount != null && x.avgAmount !== y.avgAmount) return y.avgAmount - x.avgAmount;
    if (x.count !== y.count) return y.count - x.count;
    return x.name.localeCompare(y.name, 'ko');
  });

  return { level, rows, totalCount: rows.reduce((s, r) => s + r.count, 0), unclassifiedCount };
}

/** 구 안의 동 목록 — 최근 12개월 유효 거래에 실제로 나타난 법정동(원천 표기). 추정해서 만들지 않는다. */
export function dongUniverseFromTrades(trades: readonly RegionPriceTrade[]): { key: string; name: string }[] {
  const set = new Set<string>();
  for (const t of trades) {
    const d = (t.dong ?? '').trim();
    if (d && !t.dealCanceled) set.add(d);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko')).map((d) => ({ key: d, name: d }));
}

/** 만원 정수 → "6억 2,000만원" / "3,500만원". api-molit의 formatKoreanPrice와 같은 규칙(클라이언트에서 서버 모듈을 끌어오지 않도록 여기 둔다). */
export function formatRegionAvgPrice(man: number): string {
  const n = Math.round(man);
  const eok = Math.floor(n / 10000);
  const rest = n % 10000;
  if (eok > 0) return `${eok}억${rest > 0 ? ` ${rest.toLocaleString('ko-KR')}만` : ''}원`;
  return `${n.toLocaleString('ko-KR')}만원`;
}
