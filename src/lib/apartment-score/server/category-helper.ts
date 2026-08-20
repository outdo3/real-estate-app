import type { CategoryKey, CategoryResult, Direction, PeerPoolResult } from './types';
import { CATEGORY_WEIGHTS, PEER_SAMPLE_MEDIUM } from './config';
import { rankFeature, scoreFromPercentile, type FeatureRow } from './percentile';

export interface SubMetricSpec {
  key: string;
  weight: number; // config상 base sub-weight(카테고리 내부 100 기준)
  direction: Direction;
  // §8: "거리" 계열처럼 qualityFlag=complete인데 null이면 "확인된 부재"로 sentinel
  // 처리할 feature만 true. count류는 false(=partial 취급, 재분배 대상).
  treatCompleteNullAsWorst: boolean;
}

/**
 * 5개 카테고리(transport/living/parking/complex/schoolAccess)가 공유하는 계산 골격
 * (§14~§20 missing-data 재분배 원칙이 동일해서 분리). 카테고리별 특수 로직(diminishing
 * returns, sub-weight 표 등)은 config.ts/percentile.ts에 있고, 여기는 "sub-metric들을
 * 모아 하나의 0~100 카테고리 점수로 합성 + 결측 재분배"만 담당한다.
 */
export function computeCategoryFromSubMetrics(
  categoryKey: CategoryKey,
  targetAptSeq: string,
  subMetrics: SubMetricSpec[],
  peerPool: PeerPoolResult,
  rowsByFeature: Record<string, FeatureRow[]>
): CategoryResult {
  const baseWeight = CATEGORY_WEIGHTS[categoryKey];

  if (peerPool.tier === 'NOT_SCORED') {
    return {
      key: categoryKey,
      status: 'NOT_SCORED',
      score: null,
      baseWeight,
      peerLevel: peerPool.level,
      peerTier: peerPool.tier,
      peerSampleSize: peerPool.aptSeqs.length,
      usedSubMetrics: [],
      missingSubMetrics: subMetrics.map((s) => s.key),
    };
  }

  const used: { key: string; weight: number; score: number }[] = [];
  const missing: string[] = [];

  for (const sub of subMetrics) {
    const rows = rowsByFeature[sub.key] ?? [];
    const ranked = rankFeature(rows, sub.key, sub.direction, sub.treatCompleteNullAsWorst);
    const includedCount = [...ranked.values()].filter((r) => r.included).length;
    const targetRank = ranked.get(targetAptSeq);

    if (!targetRank || !targetRank.included || targetRank.percentile == null || includedCount < PEER_SAMPLE_MEDIUM) {
      missing.push(sub.key);
      continue;
    }

    used.push({ key: sub.key, weight: sub.weight, score: scoreFromPercentile(targetRank.percentile) });
  }

  if (used.length === 0) {
    return {
      key: categoryKey,
      status: 'NOT_SCORED',
      score: null,
      baseWeight,
      peerLevel: peerPool.level,
      peerTier: peerPool.tier,
      peerSampleSize: peerPool.aptSeqs.length,
      usedSubMetrics: [],
      missingSubMetrics: missing,
    };
  }

  // 결측 sub-metric의 weight를 사용 가능한 것들에 비례 재분배(§20).
  const usedWeightSum = used.reduce((s, u) => s + u.weight, 0);
  const categoryScore = used.reduce((acc, u) => acc + (u.weight / usedWeightSum) * u.score, 0);

  return {
    key: categoryKey,
    status: missing.length === 0 ? 'SCORED' : 'PARTIAL',
    score: categoryScore,
    baseWeight,
    peerLevel: peerPool.level,
    peerTier: peerPool.tier,
    peerSampleSize: peerPool.aptSeqs.length,
    usedSubMetrics: used.map((u) => u.key),
    missingSubMetrics: missing,
  };
}
