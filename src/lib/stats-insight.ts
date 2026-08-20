// [STATISTICS V2 §5/§27] "숫자 나열"이 아니라 "판단"을 돕는 한 줄 요약을
// 만든다. 전부 실제 filter 결과에서 deterministic하게 조립한다 — AI 생성,
// 임의 추정, "매수 추천"류 표현을 쓰지 않는다(§45). 현재 RankingComplex가
// 갖고 있지 않은 값(지역 평균 대비 비교, 단지별 이집점수)은 지어내지 않고
// 생략한다 — §28에서 score 통합은 "가능한 경우에만"으로 명시돼 있고, 랭킹
// 30건 각각에 점수 API를 개별 호출하는 것은 §42(중복 fetch 금지) 원칙과
// 충돌해 이번 STEP에서는 하지 않는다(다음 STEP 후보로 문서화).
import { formatTradeCount, isLowSample } from './stats-format';

export interface InsightSourceItem {
  name: string;
  valueLabel: string;
  tradeCount: number;
}

interface BuildInsightParams {
  regionLabel: string;
  items: InsightSourceItem[];
  /** "하락폭이 큰", "신고가를 기록한" 처럼 이 화면이 순위를 매기는 기준을
      짧게 설명하는 구(조사 없이). */
  criterionPhrase: string;
}

// 화면마다 다른 문구를 각자 하드코딩하지 않고 이 함수 하나로 조립한다 —
// criterionPhrase만 RANKING_CONFIGS 쪽에서 넘겨준다(§27 "AI 생성 금지,
// 실제 filter 결과 기반 deterministic text만" 그대로).
export function buildRankingInsight({ regionLabel, items, criterionPhrase }: BuildInsightParams): string | null {
  if (items.length === 0) return null;
  const top = items[0];
  const sampleNote = isLowSample(top.tradeCount)
    ? `(표본 ${formatTradeCount(top.tradeCount)}으로 적어 참고용)`
    : `(거래 ${formatTradeCount(top.tradeCount)} 기준)`;
  return `${regionLabel}에서 ${criterionPhrase} 단지는 ${items.length}곳입니다. 1위는 ${top.name}(${top.valueLabel}) ${sampleNote}.`;
}
