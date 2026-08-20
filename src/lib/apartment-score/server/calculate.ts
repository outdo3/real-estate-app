import { prisma } from '@/lib/prisma';
import type { CategoryResult, Confidence, FinalScoreResult, RawLocationFeature, RawMasterInfo } from './types';
import { MIN_TOTAL_COVERAGE, SCORE_VERSION } from './config';
import { resolvePeerPool, type PeerCandidate } from './peer-groups';
import { computeTransportCategory } from './categories/transport';
import { computeLivingCategory } from './categories/living';
import { computeParkingCategory } from './categories/parking';
import { computeComplexCategory } from './categories/complex';
import { computeSchoolAccessCategory } from './categories/school-access';
import { computeMarketInfo } from './categories/market';
import { computeRegionalStrengths } from './regional-premium';
import { explainAllCategories } from './explain';
import { buildBriefing } from './briefing';
import { classifyPreparingReason } from './preparing-reason';

/**
 * S2C Score Engine 진입점(§3, §41 API가 이 함수 하나만 호출한다).
 * DB read-only — score를 어디에도 저장하지 않는다(§56).
 */
export async function calculateApartmentScore(aptSeq: string): Promise<FinalScoreResult> {
  const targetMaster = await prisma.apartmentMaster.findUnique({
    where: { aptSeq },
    select: {
      aptSeq: true,
      sggCd: true,
      sigungu: true,
      umdName: true,
      buildYear: true,
      totalHouseholds: true,
      parkingCount: true,
      mainBuildingCount: true,
    },
  });

  if (!targetMaster || !targetMaster.aptSeq) {
    return emptyResult('NOT_FOUND');
  }
  if (!targetMaster.sggCd) {
    return emptyResult('INSUFFICIENT_DATA');
  }

  const regionLabel = targetMaster.sigungu ?? '주변 지역';

  const cohortMasterRows = await prisma.apartmentMaster.findMany({
    where: { sggCd: targetMaster.sggCd, aptSeq: { not: null } },
    select: {
      aptSeq: true,
      sggCd: true,
      sigungu: true,
      umdName: true,
      buildYear: true,
      totalHouseholds: true,
      parkingCount: true,
      mainBuildingCount: true,
    },
  });

  const cohortAptSeqs = cohortMasterRows.map((r) => r.aptSeq!).filter(Boolean);

  const [locationRows, marketRows] = await Promise.all([
    prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: cohortAptSeqs } } }),
    prisma.apartmentMarketFeature.findMany({ where: { aptSeq: { in: cohortAptSeqs } } }),
  ]);

  const masterByAptSeq = new Map<string, RawMasterInfo>(
    cohortMasterRows.map((r) => [
      r.aptSeq!,
      {
        aptSeq: r.aptSeq!,
        sggCd: r.sggCd,
        sigungu: r.sigungu,
        umdName: r.umdName,
        buildYear: r.buildYear,
        totalHouseholds: r.totalHouseholds,
        parkingCount: r.parkingCount,
        mainBuildingCount: r.mainBuildingCount,
      },
    ])
  );
  const locationByAptSeq = new Map<string, RawLocationFeature>(locationRows.map((r) => [r.aptSeq, r as RawLocationFeature]));
  const marketByAptSeq = new Map(marketRows.map((r) => [r.aptSeq, r]));

  const peerCandidates: PeerCandidate[] = cohortMasterRows.map((r) => ({
    aptSeq: r.aptSeq!,
    sggCd: r.sggCd,
    umdName: r.umdName,
    buildYear: r.buildYear,
  }));
  const targetCandidate: PeerCandidate = {
    aptSeq: targetMaster.aptSeq,
    sggCd: targetMaster.sggCd,
    umdName: targetMaster.umdName,
    buildYear: targetMaster.buildYear,
  };

  const transportPool = resolvePeerPool(targetCandidate, peerCandidates, false);
  const livingPool = resolvePeerPool(targetCandidate, peerCandidates, false);
  const schoolPool = resolvePeerPool(targetCandidate, peerCandidates, false);
  const complexPool = resolvePeerPool(targetCandidate, peerCandidates, false);
  const parkingPool = resolvePeerPool(targetCandidate, peerCandidates, true); // §11: sigungu + buildYear decade band

  const categories: CategoryResult[] = [
    computeTransportCategory(targetMaster.aptSeq, transportPool, locationByAptSeq),
    computeLivingCategory(targetMaster.aptSeq, livingPool, locationByAptSeq),
    computeParkingCategory(targetMaster.aptSeq, parkingPool, masterByAptSeq),
    computeComplexCategory(targetMaster.aptSeq, complexPool, masterByAptSeq),
    computeSchoolAccessCategory(targetMaster.aptSeq, schoolPool, locationByAptSeq),
  ];

  const scoredCategories = categories.filter((c) => c.score != null);
  const usedWeightSum = scoredCategories.reduce((s, c) => s + c.baseWeight, 0);
  const coverage = usedWeightSum / 100;

  const regionalStrengths = computeRegionalStrengths(targetMaster.aptSeq, locationByAptSeq);
  const market = computeMarketInfo(marketByAptSeq.get(targetMaster.aptSeq) ?? null);

  // [SCORE V1.1 §5~§11] schoolAccess 설명이 상대 percentile만으로 실제 생활 거리와
  // 모순되지 않도록, 대상 단지의 원본 nearestElementaryDistanceM을 explain/briefing에
  // 그대로 넘긴다. 여기서만 raw 값을 읽고 school-access.ts의 점수 계산(peer 비교)
  // 로직 자체는 건드리지 않는다.
  const schoolAccessDistanceM = locationByAptSeq.get(targetMaster.aptSeq)?.nearestElementaryDistanceM ?? null;

  if (coverage < MIN_TOTAL_COVERAGE || scoredCategories.length === 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      score: null,
      scoreVersion: SCORE_VERSION,
      coverage,
      confidence: null,
      categories: explainAllCategories(targetMaster.aptSeq, categories, regionLabel, schoolAccessDistanceM),
      regionalStrengths,
      market,
      briefing: null,
      preparingReason: classifyPreparingReason(categories),
    };
  }

  const finalScore = scoredCategories.reduce(
    (acc, c) => acc + (c.baseWeight / usedWeightSum) * (c.score as number),
    0
  );

  const confidence = computeConfidence(coverage, scoredCategories);

  return {
    status: 'OK',
    score: Math.round(finalScore),
    scoreVersion: SCORE_VERSION,
    coverage,
    confidence,
    categories: explainAllCategories(targetMaster.aptSeq, categories, regionLabel, schoolAccessDistanceM),
    regionalStrengths,
    market,
    briefing: buildBriefing(categories, regionalStrengths, regionLabel, schoolAccessDistanceM),
    preparingReason: null,
  };
}

// §22: coverageRatio + peerSampleSize(HIGH tier 비율) 기반 confidence.
function computeConfidence(coverage: number, scoredCategories: CategoryResult[]): Confidence {
  const highTierCount = scoredCategories.filter((c) => c.peerTier === 'HIGH').length;
  if (coverage >= 0.85 && highTierCount >= 3) return 'HIGH';
  if (coverage >= MIN_TOTAL_COVERAGE) return 'MEDIUM';
  return 'LOW';
}

function emptyResult(status: 'NOT_FOUND' | 'INSUFFICIENT_DATA' | 'AMBIGUOUS'): FinalScoreResult {
  return {
    status,
    score: null,
    scoreVersion: SCORE_VERSION,
    coverage: null,
    confidence: null,
    categories: [],
    regionalStrengths: [],
    market: null,
    briefing: null,
    preparingReason: status === 'INSUFFICIENT_DATA' ? 'OTHER' : null,
  };
}
