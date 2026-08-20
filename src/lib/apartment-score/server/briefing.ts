import type { Briefing, CategoryKey, CategoryResult, RegionalStrength, RegionalStrengthType } from './types';
import { CATEGORY_WEIGHTS } from './config';
import { CATEGORY_LABELS, bandOf, type Band } from './explain';

// §33~§39: 서버 알고리즘 Algorithmic Briefing Engine. AI 호출 없음(§32/§52),
// random 선택 없음(같은 데이터 → 같은 출력, §36), 과장 표현 금지(§37).

// 한글 음절의 종성(받침) 유무로 조사를 고른다 — 카테고리/regional 라벨이 동적으로
// 조합되기 때문에(§35) explain.ts처럼 소수를 수동 지정할 수 없어 일반 공식을 쓴다.
function hasBatchim(word: string): boolean {
  const ch = word.charCodeAt(word.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return false;
  return (ch - 0xac00) % 28 !== 0;
}
const josaIGa = (word: string) => (hasBatchim(word) ? '이' : '가');
const josaEunNeun = (word: string) => (hasBatchim(word) ? '은' : '는');
const josaGwaWa = (word: string) => (hasBatchim(word) ? '과' : '와');

interface Candidate {
  key: CategoryKey | null; // null이면 regional strength
  labelShort: string | null; // closing 문장용("교통", "주차"); regional은 null
  labelNoun: string; // 본문 문장용("교통 접근성")
  band: Band;
  priority: number;
}

const CATEGORY_NOUN_FOR_BRIEFING: Record<CategoryKey, string> = {
  transport: '교통 접근성',
  living: '생활 인프라',
  parking: '주차 여건',
  complex: '단지 특성',
  schoolAccess: '초등학교 접근성',
};

const REGIONAL_STRENGTH_NOUN: Record<RegionalStrengthType, string> = {
  BEACH_ACCESS: '해변 접근성',
  SUBWAY_ACCESS: '지하철 접근성',
  MEDICAL_ACCESS: '의료 접근성',
  PARK_ACCESS: '공원 접근성',
  SCHOOL_ACCESS: '초등학교 접근성',
};

// regional strength type이 어느 core category와 주제가 겹치는지(§35 동일 category 반복 방지).
const REGIONAL_RELATED_CATEGORY: Partial<Record<RegionalStrengthType, CategoryKey>> = {
  SUBWAY_ACCESS: 'transport',
  MEDICAL_ACCESS: 'living',
  PARK_ACCESS: 'living',
  SCHOOL_ACCESS: 'schoolAccess',
};

const STRENGTH_PREDICATE_VARIANTS = [
  (region: string) => `${region} 내에서 좋은 편입니다`,
  (region: string) => `${region} 비교 단지보다 우수한 편입니다`,
];

const CAUTION_PREDICATE_VARIANTS = [(region: string) => `${region} 비교 단지보다 다소 아쉬운 편입니다`];

export function buildBriefing(
  categories: CategoryResult[],
  regionalStrengths: RegionalStrength[],
  regionLabel: string
): Briefing | null {
  const scoredCategories = categories.filter((c): c is CategoryResult & { score: number } => c.score != null);
  if (scoredCategories.length === 0) return null;

  const categoryCandidates: Candidate[] = scoredCategories
    .map((c) => ({
      key: c.key,
      labelShort: CATEGORY_LABELS[c.key],
      labelNoun: CATEGORY_NOUN_FOR_BRIEFING[c.key],
      band: bandOf(c.score),
      // [S3 §14] score(0~100) × category weight(합 100)로 순위를 매긴다 — score만 쓰면
      // weight 15인 "단지"가 buildYear 단일 sub-metric 의존도가 높아 극단적 percentile이
      // 자주 나와(S2C known limitation) weight 30인 "교통"보다 자주 앞섰다(실측
      // briefing QA에서 확인). 이 곱셈은 selection *priority*만 바꾸는 것이고
      // CATEGORY_WEIGHTS/score 산출 공식 자체는 그대로다(§14 지시대로 formula/weight 불변).
      priority: c.score * CATEGORY_WEIGHTS[c.key],
    }))
    .filter((c) => c.band === 'EXCELLENT' || c.band === 'GOOD')
    .sort((a, b) => b.priority - a.priority);

  // §39: regional strength는 최대 1개만, 관련 core category가 이미 상위 2 strength에
  // 들어있으면 같은 주제 반복을 피해 생략한다.
  const topRegional = regionalStrengths[0] ?? null;
  const strengthPool: Candidate[] = [...categoryCandidates];
  if (topRegional) {
    const related = REGIONAL_RELATED_CATEGORY[topRegional.type];
    const relatedAlreadyTop2 = related != null && categoryCandidates.slice(0, 2).some((c) => c.key === related);
    if (!relatedAlreadyTop2) {
      // regional strength는 core category weight가 없어 percentile을 카테고리와 같은
      // 스케일(0~100 점수 × weight)에 놓기 위해 임의의 weight 20을 이 우선순위 계산에만
      // 쓴다(schoolAccess/parking/complex의 15보다 조금 높은 정도 — "지역 내 눈에 띄는
      // 강점"이 평범한 카테고리 강점보다 약간 더 주목받을 만하다는 편집 판단, score
      // engine의 실제 weight/formula와는 무관).
      strengthPool.push({
        key: null,
        labelShort: null,
        labelNoun: REGIONAL_STRENGTH_NOUN[topRegional.type],
        band: topRegional.level === 'STRONG' ? 'EXCELLENT' : 'GOOD',
        priority: topRegional.percentileInSigungu * 20,
      });
    }
  }
  strengthPool.sort((a, b) => b.priority - a.priority);
  const topStrengths = strengthPool.slice(0, 2);

  const cautionCandidate = scoredCategories
    .filter((c) => bandOf(c.score) === 'BELOW_AVERAGE')
    .sort((a, b) => a.score - b.score)[0];

  const strengths: string[] = topStrengths.map((s, i) => {
    const predicate = STRENGTH_PREDICATE_VARIANTS[i % STRENGTH_PREDICATE_VARIANTS.length](regionLabel);
    return `${s.labelNoun}${josaIGa(s.labelNoun)} ${predicate}.`;
  });

  const cautionText = cautionCandidate
    ? (() => {
        const noun = CATEGORY_NOUN_FOR_BRIEFING[cautionCandidate.key];
        const predicate = CAUTION_PREDICATE_VARIANTS[0](regionLabel);
        return `다만 ${noun}${josaEunNeun(noun)} ${predicate}.`;
      })()
    : null;

  // 종합 한 줄(§34, §38 우선순위 마지막 단계): 강점이 있으면 어떤 조건을 중요하게 볼
  // 사용자에게 유효한지 구체화하고, 없으면 중립 문장으로 폴백(§37 과장 없는 어휘만 사용).
  let summary: string;
  const shortLabels = topStrengths.map((s) => s.labelShort).filter((v): v is string => v != null);
  // "단지" 카테고리가 strength로 뽑히면 종결부의 일반명사 "단지"와 겹쳐 "단지는...단지입니다"처럼
  // 주어가 중복되는 문제가 실측 QA(§54)에서 발견됨 — 종결부를 "곳입니다"로 바꿔 어떤 카테고리
  // 라벨이 오더라도 중복되지 않게 한다.
  if (shortLabels.length >= 2) {
    const joined = `${shortLabels[0]}${josaGwaWa(shortLabels[0])} ${shortLabels[1]}`;
    summary = `${joined}${josaEunNeun(shortLabels[1])} 중요하게 본다면 눈여겨볼 만한 곳입니다.`;
  } else if (shortLabels.length === 1) {
    summary = `${shortLabels[0]}${josaEunNeun(shortLabels[0])} 중요하게 본다면 눈여겨볼 만한 곳입니다.`;
  } else if (topStrengths.length > 0) {
    summary = '지역 내 강점이 있는 단지로, 세부 조건을 비교해볼 만합니다.';
  } else if (cautionCandidate) {
    summary = '지역 평균과 비슷한 수준이며, 확인이 필요한 항목을 참고해 비교해보는 것을 권장합니다.';
  } else {
    summary = '전반적으로 지역 평균 수준의 단지로, 세부 조건을 비교해보는 것을 권장합니다.';
  }

  return { summary, strengths, caution: cautionText };
}
