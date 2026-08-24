// E-JIP SCORE V2 STEP 0.8 — Shadow Peer & Score Impact Validation. READ-ONLY.
// production score engine(src/lib/apartment-score/server/*)을 전혀 수정하지 않고, 그
// 안의 순수 함수(resolvePeerPoolLevels/computeCategoryWithFallback/compute*Category/
// category-helper/percentile)를 이 파일에서 그대로 import해 재사용한다 — score
// formula/weight/percentile 정의는 1바이트도 다시 구현하지 않는다. 이 파일이 하는 일은
// 딱 하나: calculate.ts가 넘기는 "peer 후보 리스트"를 STEP 0.6 peer-quality.ts
// classify() 결과로 걸러진 리스트로 바꿔치기하는 것뿐이다(§13).
//
// production calculateApartmentScore()는 매 호출마다 DB에서 cohort를 다시 읽는다.
// STEP 0.8은 부산 전체(3,401건)를 반복 계산해야 하므로, 여기서는 전체 테이블을 1회만
// 읽고 sggCd별로 그룹핑해 메모리에서 재사용한다(N+1 방지) — 이것도 계산 로직이 아니라
// "어떻게 데이터를 넣어주느냐"의 배치 최적화일 뿐, calculate.ts의 단일-단지 오케스트레이션과
// 1:1로 대응한다.
import { prisma } from '../../../src/lib/prisma';
import { resolvePeerPoolLevels, type PeerCandidate } from '../../../src/lib/apartment-score/server/peer-groups';
import { computeCategoryWithFallback } from '../../../src/lib/apartment-score/server/calculate';
import { computeTransportCategory } from '../../../src/lib/apartment-score/server/categories/transport';
import { computeLivingCategory } from '../../../src/lib/apartment-score/server/categories/living';
import { computeParkingCategory } from '../../../src/lib/apartment-score/server/categories/parking';
import { computeComplexCategory } from '../../../src/lib/apartment-score/server/categories/complex';
import { computeSchoolAccessCategory } from '../../../src/lib/apartment-score/server/categories/school-access';
import { MIN_TOTAL_COVERAGE } from '../../../src/lib/apartment-score/server/config';
import type { CategoryResult, RawLocationFeature, RawMasterInfo } from '../../../src/lib/apartment-score/server/types';
import { classify, type QualityInput, type QualityResult } from './peer-quality';

export const BUSAN_GU_BY_LAWDCD: Record<string, string> = {
  '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구',
  '26230': '부산진구', '26260': '동래구', '26290': '남구', '26320': '북구',
  '26350': '해운대구', '26380': '사하구', '26410': '금정구', '26440': '강서구',
  '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군',
};

export interface MasterRow extends RawMasterInfo {
  name: string;
  umdCd: string | null;
  roadAddress: string | null;
  jibunAddress: string | null;
  mgmBldrgstPk: string | null;
  geocodeQuality: string | null;
  latitude: number | null;
  longitude: number | null;
}

// RawLocationFeature(production 서버 타입)에는 없지만 실제 Prisma row엔 존재하는
// nearestSubwayName(§3 peer 목록 출력에 필요) — 표시 전용 필드라 production 타입을
// 넓히지 않고 여기서만 확장한다.
export type LocationFeatureWithStationName = RawLocationFeature & { nearestSubwayName: string | null };

export interface BusanDataset {
  masters: MasterRow[];
  masterByAptSeq: Map<string, MasterRow>;
  locationByAptSeq: Map<string, LocationFeatureWithStationName>;
  marketTxByAptSeq: Map<string, number>;
  qualityByAptSeq: Map<string, QualityResult>;
  cohortsBySggCd: Map<string, MasterRow[]>;
}

// 전체 부산 데이터 1회 로드. 이후 모든 STEP 0.8 스크립트가 이 함수 하나만 호출한다 —
// 스크립트마다 다른 방식으로 DB를 읽어 서로 다른 모집단을 만드는 사고를 방지.
export async function loadBusanDataset(): Promise<BusanDataset> {
  const mastersRaw = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: {
      aptSeq: true, name: true, sggCd: true, sigungu: true, umdName: true, umdCd: true,
      roadAddress: true, jibunAddress: true, mgmBldrgstPk: true,
      totalHouseholds: true, parkingCount: true, mainBuildingCount: true, buildYear: true,
      geocodeQuality: true, latitude: true, longitude: true,
    },
  });
  const masters: MasterRow[] = mastersRaw.map((m) => ({
    aptSeq: m.aptSeq!, name: m.name, sggCd: m.sggCd, sigungu: m.sigungu, umdName: m.umdName, umdCd: m.umdCd,
    buildYear: m.buildYear, totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount,
    mainBuildingCount: m.mainBuildingCount, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress,
    mgmBldrgstPk: m.mgmBldrgstPk, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
  }));

  const aptSeqs = masters.map((m) => m.aptSeq);
  const [locationRows, marketRows] = await Promise.all([
    prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: aptSeqs } } }),
    prisma.apartmentMarketFeature.findMany({ where: { aptSeq: { in: aptSeqs } }, select: { aptSeq: true, transactionCount12m: true } }),
  ]);

  const masterByAptSeq = new Map(masters.map((m) => [m.aptSeq, m]));
  const locationByAptSeq = new Map<string, LocationFeatureWithStationName>(locationRows.map((r) => [r.aptSeq, r as LocationFeatureWithStationName]));
  const marketTxByAptSeq = new Map(marketRows.map((r) => [r.aptSeq, r.transactionCount12m ?? 0]));

  const qualityByAptSeq = new Map<string, QualityResult>();
  for (const m of masters) {
    const input: QualityInput = {
      aptSeq: m.aptSeq, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
      totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
      buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
      transactionCount12m: marketTxByAptSeq.get(m.aptSeq) ?? 0,
    };
    qualityByAptSeq.set(m.aptSeq, classify(input));
  }

  const cohortsBySggCd = new Map<string, MasterRow[]>();
  for (const m of masters) {
    if (!m.sggCd) continue;
    if (!cohortsBySggCd.has(m.sggCd)) cohortsBySggCd.set(m.sggCd, []);
    cohortsBySggCd.get(m.sggCd)!.push(m);
  }

  return { masters, masterByAptSeq, locationByAptSeq, marketTxByAptSeq, qualityByAptSeq, cohortsBySggCd };
}

function toPeerCandidate(m: MasterRow): PeerCandidate {
  return { aptSeq: m.aptSeq, sggCd: m.sggCd, umdName: m.umdName, buildYear: m.buildYear };
}

export type ShadowMode = 'PRODUCTION' | 'SHADOW_FILTERED';

export interface ScoreOutcome {
  status: 'OK' | 'INSUFFICIENT_DATA';
  score: number | null;
  coverage: number;
  categories: CategoryResult[];
}

// calculate.ts §114-153의 오케스트레이션과 1:1 대응(카테고리 조합→coverage 체크→가중합).
// 유일한 차이: mode==='SHADOW_FILTERED'일 때 카테고리별 peer 후보 리스트를 STEP 0.6
// classify() 결과로 미리 거른다(§7 도메인별 eligibility). resolvePeerPoolLevels 자체,
// computeCategoryWithFallback, compute*Category, computeCategoryFromSubMetrics,
// rankFeature, scoreFromPercentile — 전부 production 코드를 그대로 호출한다.
export function computeScoreForTarget(
  target: MasterRow,
  cohort: MasterRow[],
  ds: BusanDataset,
  mode: ShadowMode
): ScoreOutcome {
  const cohortCandidates = cohort.map(toPeerCandidate);
  const targetCandidate = toPeerCandidate(target);

  let coordOkCandidates = cohortCandidates;
  let complexCandidates = cohortCandidates;
  let parkingCandidates = cohortCandidates;

  if (mode === 'SHADOW_FILTERED') {
    coordOkCandidates = cohortCandidates.filter((c) => ds.qualityByAptSeq.get(c.aptSeq)?.transportPeerEligible === true);
    complexCandidates = cohortCandidates.filter((c) => ds.qualityByAptSeq.get(c.aptSeq)?.complexPeerEligible === true);
    parkingCandidates = cohortCandidates.filter((c) => ds.qualityByAptSeq.get(c.aptSeq)?.parkingPeerEligible === true);
  }

  // production calculate.ts: transport/living/complex/school은 전부 같은 "nonParkingLevels"
  // (dong LOCAL)를 쓴다. SHADOW에서는 complex만 자체 eligibility(§28 audit 목적)로 별도
  // 후보 리스트를 써서 production과 달리 취급한다 — 이 분리 자체가 STEP 0.8의 분석
  // 대상이므로 의도적 설계 선택이며 문서(§28)에 명시한다.
  const transportLivingSchoolLevels = resolvePeerPoolLevels(targetCandidate, coordOkCandidates, false);
  const complexLevels =
    mode === 'SHADOW_FILTERED' ? resolvePeerPoolLevels(targetCandidate, complexCandidates, false) : transportLivingSchoolLevels;
  const parkingLevels = resolvePeerPoolLevels(targetCandidate, parkingCandidates, true);

  const categories: CategoryResult[] = [
    computeCategoryWithFallback(computeTransportCategory, target.aptSeq, transportLivingSchoolLevels, ds.locationByAptSeq),
    computeCategoryWithFallback(computeLivingCategory, target.aptSeq, transportLivingSchoolLevels, ds.locationByAptSeq),
    computeCategoryWithFallback(computeParkingCategory, target.aptSeq, parkingLevels, ds.masterByAptSeq),
    computeCategoryWithFallback(computeComplexCategory, target.aptSeq, complexLevels, ds.masterByAptSeq),
    computeCategoryWithFallback(computeSchoolAccessCategory, target.aptSeq, transportLivingSchoolLevels, ds.locationByAptSeq),
  ];

  const scoredCategories = categories.filter((c) => c.score != null);
  const usedWeightSum = scoredCategories.reduce((s, c) => s + c.baseWeight, 0);
  const coverage = usedWeightSum / 100;

  if (coverage < MIN_TOTAL_COVERAGE || scoredCategories.length === 0) {
    return { status: 'INSUFFICIENT_DATA', score: null, coverage, categories };
  }

  const finalScore = scoredCategories.reduce((acc, c) => acc + (c.baseWeight / usedWeightSum) * (c.score as number), 0);
  return { status: 'OK', score: Math.round(finalScore), coverage, categories };
}

export function getCategory(outcome: ScoreOutcome, key: CategoryResult['key']): CategoryResult | undefined {
  return outcome.categories.find((c) => c.key === key);
}

export function guNameForSggCd(sggCd: string | null): string {
  return (sggCd && BUSAN_GU_BY_LAWDCD[sggCd]) || sggCd || 'unknown';
}

// §11/§21 component decomposition. transport.ts의 SUB_METRICS를 그대로 재기술(값은
// config에서 import) — rankFeature/scoreFromPercentile은 production 함수를 그대로 호출.
export interface TransportDecomposition {
  subwayComponent: number;
  busComponent: number;
  finalTransport: number;
  parts: { key: string; group: 'subway' | 'bus'; weight: number; percentile: number | null; subScore: number | null; included: boolean }[];
}

export async function buildTransportDecomposer() {
  const { rankFeature, scoreFromPercentile } = await import('../../../src/lib/apartment-score/server/percentile');
  const { TRANSPORT_SUBWEIGHTS, FEATURE_DIRECTIONS } = await import('../../../src/lib/apartment-score/server/config');
  const SUB_METRICS = [
    { key: 'nearestSubwayDistanceM' as const, weight: TRANSPORT_SUBWEIGHTS.nearestSubwayDistanceM, direction: FEATURE_DIRECTIONS.nearestSubwayDistanceM, treatCompleteNullAsWorst: true, group: 'subway' as const },
    { key: 'subwayCount1000m' as const, weight: TRANSPORT_SUBWEIGHTS.subwayCount1000m, direction: FEATURE_DIRECTIONS.subwayCount1000m, treatCompleteNullAsWorst: false, group: 'subway' as const },
    { key: 'nearestBusStopDistanceM' as const, weight: TRANSPORT_SUBWEIGHTS.nearestBusStopDistanceM, direction: FEATURE_DIRECTIONS.nearestBusStopDistanceM, treatCompleteNullAsWorst: true, group: 'bus' as const },
    { key: 'busStopCount300m' as const, weight: TRANSPORT_SUBWEIGHTS.busStopCount300m, direction: FEATURE_DIRECTIONS.busStopCount300m, treatCompleteNullAsWorst: false, group: 'bus' as const },
  ];
  return function decomposeTransport(targetAptSeq: string, peerAptSeqs: string[], locationByAptSeq: Map<string, RawLocationFeature>): TransportDecomposition {
    const parts = SUB_METRICS.map((sub) => {
      const rows = peerAptSeqs.map((aptSeq) => {
        const loc = locationByAptSeq.get(aptSeq);
        return { aptSeq, value: loc ? (loc[sub.key] as number | null) : null, isComplete: loc ? loc.qualityFlag === 'complete' : false };
      });
      const ranked = rankFeature(rows, sub.key, sub.direction, sub.treatCompleteNullAsWorst);
      const targetRank = ranked.get(targetAptSeq);
      const included = !!targetRank && targetRank.included && targetRank.percentile != null;
      return {
        key: sub.key, group: sub.group, weight: sub.weight,
        percentile: included ? targetRank!.percentile : null,
        subScore: included ? scoreFromPercentile(targetRank!.percentile as number) : null,
        included,
      };
    });
    const usedWeightSum = parts.filter((p) => p.included).reduce((s, p) => s + p.weight, 0) || 1;
    const withNorm = parts.map((p) => ({ ...p, normWeight: p.included ? p.weight / usedWeightSum : 0 }));
    const subwayComponent = withNorm.filter((p) => p.group === 'subway').reduce((s, p) => s + p.normWeight * (p.subScore ?? 0), 0);
    const busComponent = withNorm.filter((p) => p.group === 'bus').reduce((s, p) => s + p.normWeight * (p.subScore ?? 0), 0);
    return { subwayComponent, busComponent, finalTransport: subwayComponent + busComponent, parts: withNorm };
  };
}

// §20/§26/§27/§29 cross-population inversion counter. "원본 raw fact 기준으로 명백히
// 더 좋은데 최종 score는 더 낮은" pair를 threshold별로 센다 — O(n^2), n<=3000대라
// 실측상 수 초 내 종료(사전 최적화 불필요, 정확성이 우선).
export function countCrossInversions(
  entries: { aptSeq: string; raw: number; score: number }[],
  direction: 'lowerIsBetter' | 'higherIsBetter',
  thresholds: number[]
): { threshold: number; count: number; totalPairsChecked: number }[] {
  const n = entries.length;
  const results = thresholds.map((t) => ({ threshold: t, count: 0, totalPairsChecked: 0 }));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = entries[i];
      const b = entries[j];
      const rawGap = direction === 'lowerIsBetter' ? b.raw - a.raw : a.raw - b.raw; // >0이면 a가 raw상 더 좋음(격차)
      if (rawGap <= 0) continue;
      for (let k = 0; k < thresholds.length; k++) {
        if (rawGap >= thresholds[k]) {
          results[k].totalPairsChecked++;
          if (a.score < b.score) results[k].count++;
        }
      }
    }
  }
  return results;
}

