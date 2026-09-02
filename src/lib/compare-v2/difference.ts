// COMPARE_V2_PHASE2 — the difference engine. Every sentence here is a deterministic
// string template driven by data, never an LLM call (task's explicit §17/§33 prohibition).
// "comparable: false" always wins over any numeric difference — missing/mismatched data
// never resolves to an implicit winner (§13/§29 of the Phase 2 spec).
import type { CompareMetric, CompareDifference, TradeoffSummary } from './types';

// 메트릭별 "의미 있는 차이" 최소 기준 — 문서화된 휴리스틱(재조정 가능, COMPARE_V2_
// PHASE2_IMPLEMENTATION.md §7 참고). 이 기준 미만이면 강점이 아니라 "비슷한 항목"으로 분류.
const MEANINGFUL_THRESHOLDS: Record<string, { abs?: number; pct?: number }> = {
  salePrice: { pct: 0.03 },
  buildYear: { abs: 3 },
  totalHouseholds: { pct: 0.3, abs: 200 },
  parkingPerHousehold: { abs: 0.15 },
  subwayDistance: { abs: 150 },
  busDistance: { abs: 150 },
  elementaryDistance: { abs: 150 },
  convenienceCount: { abs: 3 },
};

function isMeaningful(key: string, diff: number, a: number, b: number): boolean {
  const rule = MEANINGFUL_THRESHOLDS[key];
  if (!rule) return false;
  if (rule.abs != null && Math.abs(diff) >= rule.abs) return true;
  if (rule.pct != null) {
    const denom = Math.min(Math.abs(a), Math.abs(b)) || 1;
    if (Math.abs(diff) / denom >= rule.pct) return true;
  }
  return false;
}

function formatDifferenceDisplay(key: string, diff: number): string {
  const abs = Math.abs(diff);
  switch (key) {
    case 'salePrice': {
      const eok = Math.floor(abs);
      const man = Math.round((abs - eok) * 10000);
      return eok > 0 ? `${eok}억${man > 0 ? ` ${man.toLocaleString('ko-KR')}만` : ''}` : `${man.toLocaleString('ko-KR')}만`;
    }
    case 'buildYear': return `${Math.round(abs)}년`;
    case 'totalHouseholds': return `${Math.round(abs).toLocaleString('ko-KR')}세대`;
    case 'parkingPerHousehold': return `${abs.toFixed(2)}대`;
    case 'subwayDistance': case 'busDistance': case 'elementaryDistance': return `${Math.round(abs)}m`;
    case 'convenienceCount': return `${Math.round(abs)}개`;
    default: return String(abs);
  }
}

const RECENCY_CAUTION_DAYS = 90;

function priceRecencyCaution(a: CompareMetric, b: CompareMetric): string | null {
  if (a.key !== 'salePrice' || !a.period || !b.period) return null;
  const daysApart = Math.abs(new Date(a.period.from).getTime() - new Date(b.period.from).getTime()) / 86400000;
  if (daysApart > RECENCY_CAUTION_DAYS) {
    return '두 단지의 기준 거래일 차이가 커 직접 비교 시 주의가 필요합니다.';
  }
  return null;
}

export function buildDifference(a: CompareMetric, b: CompareMetric): CompareDifference {
  const base = { metricKey: a.key, label: a.label };

  // MISSING(진짜 수집 실패/알 수 없음)은 절대 자동 승패로 이어지지 않는다 — 비교 불가.
  // "확인된 없음"(예: 반경 내 지하철역 없음이 확인된 경우, trust는 SAFE/LIMITED인 채로
  // value만 null)은 MISSING과 다르다 — 둘 다 확인된 없음이면 "비슷함"으로, 한쪽만
  // 확인된 없음이고 다른 쪽은 실제 값이 있으면 그 자체가 유효한 차이지만 숫자 차이로
  // 표현할 수 없어(없음에 임의 거리값을 지어낼 수 없음, §29) 비교 불가로 표시한다.
  if (a.trust === 'MISSING' || b.trust === 'MISSING') {
    return {
      ...base, a, b, direction: a.direction, comparable: false,
      reason: '데이터 없음', differenceValue: null, differenceDisplay: null, favors: null,
      contextSentence: null, caution: null,
    };
  }
  if (a.value == null && b.value == null) {
    return {
      ...base, a, b, direction: a.direction, comparable: true,
      reason: undefined, differenceValue: null, differenceDisplay: null, favors: null,
      contextSentence: null, caution: null,
    };
  }
  if (a.value == null || b.value == null) {
    return {
      ...base, a, b, direction: a.direction, comparable: false,
      reason: '한쪽은 확인된 데이터가 없어 직접 비교하기 어렵습니다.', differenceValue: null, differenceDisplay: null, favors: null,
      contextSentence: null, caution: null,
    };
  }

  const areaMismatch = a.key === 'salePrice' && a.area && b.area && Math.abs(a.area.exclusiveAreaM2 - b.area.exclusiveAreaM2) > 3;
  if (areaMismatch) {
    return {
      ...base, a, b, direction: a.direction, comparable: false,
      reason: '면적이 달라 직접 비교하기 어렵습니다.', differenceValue: null, differenceDisplay: null, favors: null,
      contextSentence: null, caution: null,
    };
  }

  const diff = a.value - b.value;
  const meaningful = isMeaningful(a.key, diff, a.value, b.value);
  const differenceDisplay = diff === 0 ? null : formatDifferenceDisplay(a.key, diff);

  let favors: 'a' | 'b' | null = null;
  if (meaningful && (a.direction === 'higher-better' || a.direction === 'lower-better')) {
    const aIsMore = a.value > b.value;
    favors = a.direction === 'higher-better' ? (aIsMore ? 'a' : 'b') : (aIsMore ? 'b' : 'a');
  }

  const caution = priceRecencyCaution(a, b);

  const contextSentence =
    meaningful && differenceDisplay
      ? favors
        ? `${a.label} 기준으로 ${favors === 'a' ? '첫 번째 단지' : '두 번째 단지'}가 상대적으로 유리합니다 (차이 ${differenceDisplay}).`
        : `${a.label} 차이가 있습니다 (${differenceDisplay}) — 이 항목은 어느 쪽이 "더 낫다"고 판단하지 않습니다.`
      : null;

  return {
    ...base, a, b, direction: a.direction, comparable: true, reason: undefined,
    differenceValue: diff, differenceDisplay, favors, contextSentence, caution,
  };
}

export function buildDifferences(aMetrics: CompareMetric[], bMetrics: CompareMetric[]): CompareDifference[] {
  const bByKey = new Map(bMetrics.map((m) => [m.key, m]));
  return aMetrics
    .map((a) => {
      const b = bByKey.get(a.key);
      return b ? buildDifference(a, b) : null;
    })
    .filter((d): d is CompareDifference => d !== null);
}

export function buildTradeoffSummary(differences: CompareDifference[]): TradeoffSummary {
  const directional = differences.filter((d) => d.direction === 'higher-better' || d.direction === 'lower-better');
  return {
    aStrengths: directional.filter((d) => d.comparable && d.favors === 'a'),
    bStrengths: directional.filter((d) => d.comparable && d.favors === 'b'),
    similar: directional.filter((d) => d.comparable && d.favors === null),
    needsReview: differences.filter((d) => !d.comparable),
  };
}

// 첫 화면 "핵심 차이" 요약 — 최대 3개. directional 강점(있다면 양쪽에서 최소 1개씩
// 우선) + context-only(가격 등) 중 의미 있는 차이를 섞어, 스크롤 없이 가장 중요한
// 차이를 이해하게 한다(Phase 1 §48 first-screen-decision-value).
export function buildHeadlineDifferences(differences: CompareDifference[], tradeoff: TradeoffSummary): CompareDifference[] {
  const contextWithDiff = differences.filter(
    (d) => d.direction === 'context-only' && d.comparable && d.differenceDisplay && !d.favors
  );
  const picks: CompareDifference[] = [];
  if (tradeoff.aStrengths[0]) picks.push(tradeoff.aStrengths[0]);
  if (tradeoff.bStrengths[0]) picks.push(tradeoff.bStrengths[0]);
  if (contextWithDiff[0]) picks.push(contextWithDiff[0]);
  for (const extra of [...tradeoff.aStrengths.slice(1), ...tradeoff.bStrengths.slice(1)]) {
    if (picks.length >= 3) break;
    if (!picks.includes(extra)) picks.push(extra);
  }
  return picks.slice(0, 3);
}
