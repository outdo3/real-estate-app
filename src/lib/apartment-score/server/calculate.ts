import { prisma } from '@/lib/prisma';
import type { CategoryResult, Confidence, FinalScoreResult, PeerPoolResult, RawLocationFeature, RawMasterInfo } from './types';
import { MIN_TOTAL_COVERAGE, SCORE_VERSION } from './config';
import { resolvePeerPoolLevels, type PeerCandidate } from './peer-groups';
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
import { calculateScoreV2 } from '../../score-v2/engine';
import { adaptToV2Input } from '../../score-v2/adapter';
import { getApartmentEducationZone } from '../../education/attendance-zone';

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
      geocodeQuality: true,
    },
  });

  if (!targetMaster || !targetMaster.aptSeq) {
    return emptyResult('NOT_FOUND');
  }
  if (!targetMaster.sggCd) {
    return emptyResult('INSUFFICIENT_DATA');
  }

  // [BUSAN SCORE DATA V1 §3] 예전엔 이 sigungu 이름 하나를 모든 카테고리 설명에
  // 그대로 썼다 — 실제로는 카테고리마다 LOCAL(동)/SIGUNGU(구)/REGION_WIDE(전체) 중
  // 다른 peer level을 쓸 수 있는데(§25 실측: 94.3%가 LOCAL) 텍스트는 항상 sigungu만
  // 말해 실제보다 넓은 비교처럼 보였다. explain.ts/briefing.ts가 카테고리별
  // CategoryResult.peerLevel을 보고 정확한 표현을 고르도록 sigungu/umdName을 그대로
  // 넘긴다(점수/formula는 무관, 텍스트 정확도만 수정).
  const sigunguLabel = targetMaster.sigungu ?? '주변 지역';
  const umdName = targetMaster.umdName;

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
      geocodeQuality: true,
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
          geocodeQuality: (r as any).geocodeQuality,
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

  // [PEER FALLBACK HOTFIX] resolvePeerPool()이 고르는 "nominal" 레벨은 후보
  // 존재 개수만 볼 뿐, 그 후보들이 실제로 해당 카테고리의 sub-metric 값을 갖고
  // 있는지는 모른다(peer-groups.ts 관심사 분리). LOCAL 표본이 딱 PEER_SAMPLE_MEDIUM
  // 근처인 소규모 동에서 그중 일부가 값을 결측하면 카테고리 전체가 NOT_SCORED로
  // 빠지면서도 SIGUNGU로 재시도하지 못하던 실측 버그(BUSAN SCORE DATA V1 §18-A,
  // 8건 재현)를 막기 위해, 카테고리 단위로 LOCAL → SIGUNGU → REGION_WIDE 순서를
  // 전부 시도한다(computeCategoryWithFallback). score formula/weight/percentile
  // 정의는 전혀 건드리지 않는다 — 어느 후보 리스트를 넣느냐만 바뀐다.
  const nonParkingLevels = resolvePeerPoolLevels(targetCandidate, peerCandidates, false);
  const parkingLevels = resolvePeerPoolLevels(targetCandidate, peerCandidates, true); // §11: sigungu + buildYear decade band

  const categories: CategoryResult[] = [
    computeCategoryWithFallback(computeTransportCategory, targetMaster.aptSeq, nonParkingLevels, locationByAptSeq),
    computeCategoryWithFallback(computeLivingCategory, targetMaster.aptSeq, nonParkingLevels, locationByAptSeq),
    computeCategoryWithFallback(computeParkingCategory, targetMaster.aptSeq, parkingLevels, masterByAptSeq),
    computeCategoryWithFallback(computeComplexCategory, targetMaster.aptSeq, nonParkingLevels, masterByAptSeq),
    computeCategoryWithFallback(computeSchoolAccessCategory, targetMaster.aptSeq, nonParkingLevels, locationByAptSeq),
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

  let shadowV2Result: any = null;
  try {
    const eduZone = getApartmentEducationZone(targetMaster.aptSeq);
    const attendanceZoneStatus = eduZone ? eduZone.elementary.status : 'NOT_AVAILABLE';
    const v2Input = adaptToV2Input(
      masterByAptSeq.get(targetMaster.aptSeq)!, 
      locationByAptSeq.get(targetMaster.aptSeq) ?? null,
      attendanceZoneStatus as any
    );
    shadowV2Result = calculateScoreV2(v2Input, 2026);
  } catch (err) {
    console.error('[ScoreV2 Shadow Error]', err);
  }

  if (coverage < MIN_TOTAL_COVERAGE || scoredCategories.length === 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      score: null,
      scoreVersion: SCORE_VERSION,
      coverage,
      confidence: null,
      categories: explainAllCategories(targetMaster.aptSeq, categories, sigunguLabel, umdName, schoolAccessDistanceM),
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
    categories: explainAllCategories(targetMaster.aptSeq, categories, sigunguLabel, umdName, schoolAccessDistanceM),
    regionalStrengths,
    market,
    briefing: buildBriefing(categories, regionalStrengths, sigunguLabel, umdName, schoolAccessDistanceM),
    preparingReason: null,
      _shadowV2: shadowV2Result,
  };
}

// [PEER FALLBACK HOTFIX] 카테고리 단위 peer-level retry. levels는 이미
// resolvePeerPoolLevels()가 LOCAL→SIGUNGU→REGION_WIDE 순서로 정렬해 반환한
// 배열(항상 1개 이상 — REGION_WIDE가 최종 안전망으로 항상 포함됨). 첫 레벨에서
// status가 'NOT_SCORED'가 아니면(SCORED/PARTIAL) 즉시 그 결과를 쓴다 — 기존
// 3,059건은 전부 LOCAL 1회 시도에서 바로 성공하므로 동작·성능 영향이 없다.
// 한 카테고리 안에서 sub-metric마다 다른 레벨을 섞어 쓰지 않는다(§7/§8 요구:
// 카테고리 전체가 항상 같은 레벨의 동질 표본으로만 계산됨) — CategoryResult.peerLevel은
// 실제로 채택된 레벨을 그대로 담아 반환되므로 regionLabel도 자동으로 정확해진다.
export function computeCategoryWithFallback<T>(
  computeFn: (targetAptSeq: string, peerPool: PeerPoolResult, data: T) => CategoryResult,
  targetAptSeq: string,
  levels: PeerPoolResult[],
  data: T
): CategoryResult {
  let last: CategoryResult = computeFn(targetAptSeq, levels[0], data);
  for (let i = 1; i < levels.length && last.status === 'NOT_SCORED'; i++) {
    last = computeFn(targetAptSeq, levels[i], data);
  }
  return last;
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
