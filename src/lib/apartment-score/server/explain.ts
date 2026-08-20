import type { CategoryKey, CategoryResult, ExplainedCategory } from './types';

// §32: explanation은 raw metric(카테고리 점수)+peer 결과에서만 결정론적으로 생성한다.
// AI 호출 없음, 임의 자연어 판단 없음.

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  transport: '교통',
  living: '생활편의',
  parking: '주차',
  complex: '단지',
  schoolAccess: '학교 접근성',
};

interface NounPhrase {
  noun: string;
  particle: '이' | '가'; // 받침 유무에 따른 조사(§35), 카테고리 5개뿐이라 수동 지정
}

const CATEGORY_NOUN: Record<CategoryKey, NounPhrase> = {
  transport: { noun: '교통 접근성', particle: '이' },
  living: { noun: '생활 인프라', particle: '가' },
  parking: { noun: '세대당 주차 여건', particle: '이' },
  complex: { noun: '단지 특성', particle: '이' },
  schoolAccess: { noun: '초등학교 접근성', particle: '이' },
};

type Band = 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'BELOW_AVERAGE';

function bandOf(score: number): Band {
  if (score >= 85) return 'EXCELLENT';
  if (score >= 65) return 'GOOD';
  if (score >= 45) return 'AVERAGE';
  return 'BELOW_AVERAGE';
}

// 밴드별 2개 variant. random 선택 금지(§36) — aptSeq 기반 결정론적 선택으로 같은
// 데이터의 같은 단지는 항상 같은 문장을 반환한다.
const BAND_TEMPLATES: Record<Band, ((region: string) => string)[]> = {
  EXCELLENT: [
    (region) => `${region} 비교 단지들 중 상위권입니다.`,
    (region) => `${region} 내에서 뚜렷하게 우수한 편입니다.`,
  ],
  GOOD: [
    (region) => `${region} 비교 단지보다 좋은 편입니다.`,
    (region) => `${region} 평균보다 양호한 수준입니다.`,
  ],
  AVERAGE: [
    (region) => `${region} 평균 수준입니다.`,
    (region) => `${region} 비교 단지와 비슷한 수준입니다.`,
  ],
  BELOW_AVERAGE: [
    (region) => `${region} 비교 단지보다 다소 아쉬운 편이라 확인해볼 만합니다.`,
    (region) => `${region} 평균보다 낮은 편입니다.`,
  ],
};

function deterministicIndex(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}

export function explainCategory(aptSeq: string, cat: CategoryResult, regionLabel: string): ExplainedCategory {
  const label = CATEGORY_LABELS[cat.key];

  if (cat.score == null) {
    return { key: cat.key, label, score: null, explanation: null };
  }

  const band = bandOf(cat.score);
  const variants = BAND_TEMPLATES[band];
  const variant = variants[deterministicIndex(`${aptSeq}:${cat.key}`, variants.length)];
  const { noun, particle } = CATEGORY_NOUN[cat.key];

  return {
    key: cat.key,
    label,
    score: Math.round(cat.score),
    explanation: `${noun}${particle} ${variant(regionLabel)}`,
  };
}

export function explainAllCategories(aptSeq: string, categories: CategoryResult[], regionLabel: string): ExplainedCategory[] {
  return categories.map((c) => explainCategory(aptSeq, c, regionLabel));
}

export { bandOf };
export type { Band };
