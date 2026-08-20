import type { AbsoluteDistanceBand, Band } from './types';

// [SCORE V1.1 §5, §9~§12] 학교 접근성 설명 = 절대 거리(체감) + 상대 percentile(지역 내
// 비교)을 분리해서 만들고, 항상 절대(실제 생활 거리) 문장을 먼저 말한 뒤 상대 문장을
// 보조로 붙인다. 상대가 낮다는 이유만으로 절대가 가까운 사실을 뒤집어 "아쉽다"라고
// 단독으로 말하는 것을 구조적으로 막는다(§11 contradiction prevention).
//
// §35 금지 어휘: "좋은 학군", "교육 수준이 높다", "명문" 류는 이 모듈에서 절대 쓰지
// 않는다 — 여기서 다루는 건 "거리(접근성)"이지 "학교 품질/학군"이 아니다.

const LEAD_BY_ABSOLUTE: Record<AbsoluteDistanceBand, string> = {
  VERY_CLOSE: '초등학교까지 매우 가까운 편입니다',
  CLOSE: '초등학교까지 가까운 편으로, 통학 접근성이 좋은 편입니다',
  NORMAL: '초등학교까지 도보로 다닐 만한 무난한 거리입니다',
  FAR: '초등학교까지 거리가 있는 편이라 실제 통학 거리를 확인해볼 필요가 있습니다',
  VERY_FAR: '초등학교까지 거리가 먼 편이라 실제 통학 거리를 확인해볼 필요가 있습니다',
  UNKNOWN: '인근 1000m 이내에서 초등학교 접근성 정보가 확인되지 않았습니다',
};

function tailByRelative(absBand: AbsoluteDistanceBand, relBand: Band, region: string): string {
  if (absBand === 'UNKNOWN') return ''; // §34 E: 데이터 없음은 품질/거리 추정을 하지 않는다
  if (relBand === 'AVERAGE') return '';

  const isPositiveRelative = relBand === 'EXCELLENT' || relBand === 'GOOD';
  const isCloseAbsolute = absBand === 'VERY_CLOSE' || absBand === 'CLOSE';
  const isFarAbsolute = absBand === 'FAR' || absBand === 'VERY_FAR';

  if (isPositiveRelative) {
    if (isFarAbsolute) {
      // §34 B: far + relative-high가 "매우 좋다"로 단독 과장되지 않도록 항상 거리 caveat를 남긴다.
      return ` 다만 ${region} 내 비교로는 상대적으로 나은 편입니다.`;
    }
    return ` ${region} 내에서도 상대적으로 좋은 편입니다.`;
  }

  // relBand === 'BELOW_AVERAGE'
  if (isCloseAbsolute) {
    // §11 핵심 요구사항 예시 문장 그대로: 절대 긍정 리드 뒤에 상대는 부드러운 caveat로만 붙인다.
    return ` 다만 ${region} 내에서는 더 가까운 단지도 있습니다.`;
  }
  if (absBand === 'NORMAL') {
    return ` ${region} 비교 단지보다는 다소 아쉬운 편입니다.`;
  }
  // §34 D: far + relative-low는 caution을 포함해도 된다(절대도 이미 멀다는 사실과 일치하므로).
  return ` ${region} 비교로도 아쉬운 편이라 확인이 필요합니다.`;
}

export function buildSchoolAccessSentence(
  absBand: AbsoluteDistanceBand,
  relBand: Band | null,
  region: string
): string {
  const lead = LEAD_BY_ABSOLUTE[absBand];
  if (relBand == null) return `${lead}.`;
  const tail = tailByRelative(absBand, relBand, region);
  return `${lead}.${tail}`;
}

// briefing.ts caution 문장(짧은 "다만 X는 Y" 한 줄 포맷)에 넣을 축약형이 필요할 때 사용.
// absBand가 VERY_CLOSE/CLOSE면 caution으로 쓰기에 부적절한 단독 부정문이 아니라
// "가깝지만" 리드가 포함된 완전한 문장을 그대로 caution 자리에 넣는다(§11 예시와 동일 형태).
export function buildSchoolAccessCaution(
  absBand: AbsoluteDistanceBand,
  region: string
): string | null {
  if (absBand === 'UNKNOWN') return null; // §34 E
  const lead = LEAD_BY_ABSOLUTE[absBand];
  const tail = tailByRelative(absBand, 'BELOW_AVERAGE', region);
  return `${lead}.${tail}`.trim();
}
