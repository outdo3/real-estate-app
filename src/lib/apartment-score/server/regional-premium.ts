import type { RawLocationFeature, RegionalStrength, RegionalStrengthType } from './types';
import {
  REGIONAL_STRENGTH_STRONG_PERCENTILE,
  REGIONAL_STRENGTH_NOTABLE_PERCENTILE,
  REGIONAL_STRENGTH_MIN_SAMPLE,
} from './config';
import { rankFeature, type FeatureRow } from './percentile';

interface StrengthDef {
  type: RegionalStrengthType;
  featureKey: keyof RawLocationFeature;
  direction: 'lowerIsBetter' | 'higherIsBetter';
  treatCompleteNullAsWorst: boolean;
  labelStrong: string;
  labelNotable: string;
}

// §23/§24: 지역을 하드코딩(해운대=beach, 서구=subway)하지 않는다 — 5개 타입 전부
// 모든 sigungu에서 동일한 기준(같은 sigungu peer 내 percentile)으로 판정하고, 실제로
// 상위권일 때만 strength가 생성된다. §27 상관관계 분석은 이 판정에 쓰지 않는다(인과
// 단정 금지) — 통계적 유의성이 아니라 "그 지역 안에서 상대적으로 두드러지는가"만 본다.
const STRENGTH_DEFS: StrengthDef[] = [
  {
    type: 'BEACH_ACCESS',
    featureKey: 'beachDistanceM',
    direction: 'lowerIsBetter',
    treatCompleteNullAsWorst: true,
    labelStrong: '해변 접근성이 지역 내에서 매우 좋은 편이에요',
    labelNotable: '해변 접근성이 지역 내에서 좋은 편이에요',
  },
  {
    type: 'SUBWAY_ACCESS',
    featureKey: 'nearestSubwayDistanceM',
    direction: 'lowerIsBetter',
    treatCompleteNullAsWorst: true,
    labelStrong: '지하철 접근성이 지역 내에서 매우 좋은 편이에요',
    labelNotable: '지하철 접근성이 지역 내에서 좋은 편이에요',
  },
  {
    type: 'MEDICAL_ACCESS',
    featureKey: 'hospitalCount1000m',
    direction: 'higherIsBetter',
    treatCompleteNullAsWorst: false,
    labelStrong: '의료 접근성이 지역 내에서 매우 좋은 편이에요',
    labelNotable: '의료 접근성이 지역 내에서 좋은 편이에요',
  },
  {
    type: 'PARK_ACCESS',
    featureKey: 'parkCount1000m',
    direction: 'higherIsBetter',
    treatCompleteNullAsWorst: false,
    labelStrong: '공원 접근성이 지역 내에서 매우 좋은 편이에요',
    labelNotable: '공원 접근성이 지역 내에서 좋은 편이에요',
  },
  {
    type: 'SCHOOL_ACCESS',
    featureKey: 'nearestElementaryDistanceM',
    direction: 'lowerIsBetter',
    treatCompleteNullAsWorst: true,
    labelStrong: '초등학교 접근성이 지역 내에서 매우 좋은 편이에요',
    labelNotable: '초등학교 접근성이 지역 내에서 좋은 편이에요',
  },
];

function hasVariance(rows: FeatureRow[]): boolean {
  const values = rows.map((r) => r.value).filter((v): v is number => v != null);
  if (values.length < REGIONAL_STRENGTH_MIN_SAMPLE) return false;
  const sorted = [...values].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  return p75 - p25 > 0; // §25: 구분력(variance) 없으면 badge 의미 없음
}

/**
 * @param sigunguLocationByAptSeq 대상 apt와 같은 sigungu의 ApartmentLocationFeature
 *   전체(§26 서구/해운대 실측 규모 139~278건 기준 — REGION_WIDE 폴백 없이 sigungu만 사용,
 *   Regional Premium은 정의상 "그 지역 안에서" 상대적 강점이라 폴백이 의미가 없다).
 */
export function computeRegionalStrengths(
  targetAptSeq: string,
  sigunguLocationByAptSeq: Map<string, RawLocationFeature>
): RegionalStrength[] {
  const strengths: RegionalStrength[] = [];

  for (const def of STRENGTH_DEFS) {
    const rows: FeatureRow[] = [...sigunguLocationByAptSeq.entries()].map(([aptSeq, loc]) => ({
      aptSeq,
      value: loc[def.featureKey] as number | null,
      isComplete: loc.qualityFlag === 'complete',
    }));

    if (!hasVariance(rows)) continue;

    const ranked = rankFeature(rows, def.featureKey, def.direction, def.treatCompleteNullAsWorst);
    const targetRank = ranked.get(targetAptSeq);
    if (!targetRank || !targetRank.included || targetRank.percentile == null) continue;

    const includedCount = [...ranked.values()].filter((r) => r.included).length;
    if (includedCount < REGIONAL_STRENGTH_MIN_SAMPLE) continue;

    if (targetRank.percentile >= REGIONAL_STRENGTH_STRONG_PERCENTILE) {
      strengths.push({ type: def.type, level: 'STRONG', label: def.labelStrong, percentileInSigungu: targetRank.percentile });
    } else if (targetRank.percentile >= REGIONAL_STRENGTH_NOTABLE_PERCENTILE) {
      strengths.push({ type: def.type, level: 'NOTABLE', label: def.labelNotable, percentileInSigungu: targetRank.percentile });
    }
  }

  return strengths.sort((a, b) => b.percentileInSigungu - a.percentileInSigungu);
}
