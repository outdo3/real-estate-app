// SCHOOLINFO / SCHOOL V2.1 §11/§13/§26 — "이집의 해석"은 학교에 대한 가치판단이
// 아니라 실제 비교 가능한 값(거리/가격/연식/세대수)에서 나오는 deterministic한
// 주거 의사결정 해석이다. AI/LLM이 수치를 만들거나 없는 정보를 보완하지 않는다 —
// 이 파일은 순수 함수만 포함하고 값이 부족하면 조용히 항목을 생략한다(추정 없음).

export interface ComparableApartment {
  aptSeq: string;
  name: string;
  distanceKm: number | null;
  dealAmount: number | null; // 만원 단위
  buildYear: number | null;
  totalHouseholds: number | null;
  isCurrent?: boolean;
}

export interface DecisionInsight {
  text: string;
}

function formatEok(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const rest = manwon % 10000;
  if (eok > 0) return `${eok}억${rest > 0 ? ` ${rest.toLocaleString('ko-KR')}만` : ''}`;
  return `${manwon.toLocaleString('ko-KR')}만`;
}

// 비교는 최소 2개 이상의 유효한(null 아닌) 값이 있어야 의미가 있다 — 1개뿐이면
// "가장 가깝다"는 말 자체가 성립하지 않으므로 생성하지 않는다.
function pickExtreme<T>(items: T[], getValue: (t: T) => number | null, mode: 'min' | 'max'): T | null {
  const valid = items.filter((i) => getValue(i) != null);
  if (valid.length < 2) return null;
  return valid.reduce((best, cur) => {
    const bestVal = getValue(best)!;
    const curVal = getValue(cur)!;
    return (mode === 'min' ? curVal < bestVal : curVal > bestVal) ? cur : best;
  });
}

export function buildDecisionInsights(apartments: ComparableApartment[]): DecisionInsight[] {
  const insights: DecisionInsight[] = [];
  if (apartments.length < 2) return insights;

  const current = apartments.find((a) => a.isCurrent) ?? null;

  const nearest = pickExtreme(apartments, (a) => a.distanceKm, 'min');
  if (nearest) {
    const km = nearest.distanceKm!;
    const label = km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
    insights.push({ text: `${nearest.name}이(가) 이 학교와 가장 가깝습니다(직선거리 약 ${label}).` });
  }

  const cheapest = pickExtreme(apartments, (a) => a.dealAmount, 'min');
  const mostExpensive = pickExtreme(apartments, (a) => a.dealAmount, 'max');
  if (cheapest && mostExpensive && cheapest.aptSeq !== mostExpensive.aptSeq) {
    const gap = mostExpensive.dealAmount! - cheapest.dealAmount!;
    insights.push({
      text: `${mostExpensive.name}(${formatEok(mostExpensive.dealAmount!)})이(가) ${cheapest.name}(${formatEok(cheapest.dealAmount!)})보다 최근 매매가가 약 ${formatEok(gap)} 더 높습니다.`,
    });
  }

  const newest = pickExtreme(apartments, (a) => a.buildYear, 'max');
  if (newest) {
    insights.push({ text: `${newest.name}이(가) ${newest.buildYear}년 준공으로 가장 신축입니다.` });
  }

  if (current) {
    const distanceRank = apartments
      .filter((a) => a.distanceKm != null)
      .sort((a, b) => a.distanceKm! - b.distanceKm!);
    const idx = distanceRank.findIndex((a) => a.aptSeq === current.aptSeq);
    if (idx === 0 && distanceRank.length > 1) {
      insights.push({ text: `현재 보고 있는 ${current.name}이(가) 연결 후보 중 학교와 가장 가깝습니다.` });
    } else if (idx > 0) {
      insights.push({ text: `현재 보고 있는 ${current.name}은(는) 거리 기준 ${idx + 1}번째로 가깝습니다.` });
    }
  }

  return insights;
}
