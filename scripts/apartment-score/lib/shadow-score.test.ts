// E-JIP SCORE V2 STEP 0.8 — shadow-score.ts fixture tests. node:test, DB 없음(in-memory
// fixture만 사용) — production DB에 절대 쓰지 않는다는 것을 여기서도 구조적으로 보장한다
// (shadow-score.ts 자체가 read만 하는 함수들로 구성되어 있고, 이 테스트는 그 함수를
// prisma 없이 순수 fixture로만 호출한다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScoreForTarget, countCrossInversions, type BusanDataset, type MasterRow, type LocationFeatureWithStationName } from './shadow-score';
import type { QualityResult } from './peer-quality';

function master(overrides: Partial<MasterRow> & { aptSeq: string }): MasterRow {
  return {
    name: overrides.aptSeq, sggCd: '26140', sigungu: '서구', umdName: 'DONG_A', umdCd: null,
    buildYear: 2010, totalHouseholds: 300, parkingCount: 300, mainBuildingCount: 3,
    roadAddress: '주소', jibunAddress: null, mgmBldrgstPk: 'PK', geocodeQuality: 'exact',
    latitude: 35.1, longitude: 129.0,
    ...overrides,
  };
}

function loc(aptSeq: string, nearestSubwayDistanceM: number | null): [string, LocationFeatureWithStationName] {
  return [aptSeq, {
    aptSeq, nearestSubwayDistanceM, nearestSubwayName: null, subwayCount1000m: 1, nearestBusStopDistanceM: 50, busStopCount300m: 5,
    martCount1000m: 2, convenienceCount500m: 2, pharmacyCount500m: 2, hospitalCount1000m: 2, parkCount1000m: 2,
    daycareKindergartenCount500m: 2, nearestElementaryDistanceM: 300, elementaryCount1000m: 1, beachDistanceM: null,
    qualityFlag: 'complete',
  }];
}

function fullQuality(aptSeq: string): QualityResult {
  return {
    aptSeq, identity: 'IDENTITY_HIGH', coord: 'COORD_HIGH', registryLinked: true, registryAttempted: true,
    marketEvidence: 'STRONG', hasAddress: true, peerEligibility: 'PEER_FULL',
    transportPeerEligible: true, livePeerEligible: true, schoolPeerEligible: true,
    parkingPeerEligible: true, complexPeerEligible: true,
  };
}

function displayOnlyQuality(aptSeq: string): QualityResult {
  return {
    aptSeq, identity: 'IDENTITY_LOW', coord: 'COORD_LOW', registryLinked: false, registryAttempted: false,
    marketEvidence: 'WEAK', hasAddress: false, peerEligibility: 'DISPLAY_ONLY',
    transportPeerEligible: false, livePeerEligible: false, schoolPeerEligible: false,
    parkingPeerEligible: false, complexPeerEligible: false,
  };
}

// 12개 HIGH-quality peer + 대상 1개(같은 동) — LOCAL tier=HIGH(>=10) 보장.
function buildDataset(opts: { pollutedCount: number }): { ds: BusanDataset; target: MasterRow; cohort: MasterRow[] } {
  const target = master({ aptSeq: 'TARGET', umdName: 'DONG_A' });
  const cohort: MasterRow[] = [target];
  const locationByAptSeq = new Map<string, LocationFeatureWithStationName>([loc('TARGET', 300)]);
  const qualityByAptSeq = new Map<string, QualityResult>([['TARGET', fullQuality('TARGET')]]);

  for (let i = 0; i < 12; i++) {
    const aptSeq = `PEER_HIGH_${i}`;
    cohort.push(master({ aptSeq, umdName: 'DONG_A' }));
    locationByAptSeq.set(aptSeq, loc(aptSeq, 100 + i * 20)[1]);
    qualityByAptSeq.set(aptSeq, fullQuality(aptSeq));
  }
  for (let i = 0; i < opts.pollutedCount; i++) {
    const aptSeq = `PEER_POLLUTED_${i}`;
    cohort.push(master({ aptSeq, umdName: 'DONG_A' }));
    locationByAptSeq.set(aptSeq, loc(aptSeq, 20 + i * 5)[1]); // 오염된 peer가 항상 더 가까운 값(=distance 왜곡 유발)
    qualityByAptSeq.set(aptSeq, displayOnlyQuality(aptSeq));
  }

  const masterByAptSeq = new Map(cohort.map((m) => [m.aptSeq, m]));
  const ds: BusanDataset = {
    masters: cohort, masterByAptSeq, locationByAptSeq, marketTxByAptSeq: new Map(), qualityByAptSeq,
    cohortsBySggCd: new Map([['26140', cohort]]),
  };
  return { ds, target, cohort };
}

test('PEER_FULL(coordOk) 대상은 SHADOW_FILTERED에서 정상적으로 SCORED된다', () => {
  const { ds, target, cohort } = buildDataset({ pollutedCount: 3 });
  const outcome = computeScoreForTarget(target, cohort, ds, 'SHADOW_FILTERED');
  assert.equal(outcome.status, 'OK');
  const transport = outcome.categories.find((c) => c.key === 'transport')!;
  assert.equal(transport.status, 'SCORED');
});

test('DISPLAY_ONLY(coord=COORD_LOW) peer는 SHADOW_FILTERED peer 후보에서 완전히 제외된다', () => {
  const { ds, target, cohort } = buildDataset({ pollutedCount: 3 });
  const outcome = computeScoreForTarget(target, cohort, ds, 'SHADOW_FILTERED');
  const transport = outcome.categories.find((c) => c.key === 'transport')!;
  // peerSampleSize = TARGET(1) + HIGH peer(12) = 13. 오염된 3개(PEER_POLLUTED_*)는 절대 포함되지 않는다.
  assert.equal(transport.peerSampleSize, 13);
});

test('PRODUCTION 모드는 DISPLAY_ONLY peer도 그대로 포함한다(기존 동작 보존 확인)', () => {
  const { ds, target, cohort } = buildDataset({ pollutedCount: 3 });
  const outcome = computeScoreForTarget(target, cohort, ds, 'PRODUCTION');
  const transport = outcome.categories.find((c) => c.key === 'transport')!;
  assert.equal(transport.peerSampleSize, 16); // TARGET + 12 HIGH + 3 POLLUTED, 필터링 없음
});

test('production formula 자체는 변경되지 않는다: PRODUCTION 모드 percentile/score 계산이 오염 유무와 무관하게 동일 알고리즘(percentile.rankFeature)을 그대로 사용', () => {
  const { ds: dsNoPollution, target: t1, cohort: c1 } = buildDataset({ pollutedCount: 0 });
  const outcome = computeScoreForTarget(t1, c1, dsNoPollution, 'PRODUCTION');
  const transport = outcome.categories.find((c) => c.key === 'transport')!;
  // 오염 0개일 때 PRODUCTION과 SHADOW_FILTERED는 완전히 동일해야 한다(필터링할 대상이 없으므로).
  const shadowOutcome = computeScoreForTarget(t1, c1, dsNoPollution, 'SHADOW_FILTERED');
  const shadowTransport = shadowOutcome.categories.find((c) => c.key === 'transport')!;
  assert.equal(transport.score, shadowTransport.score);
  assert.equal(transport.peerSampleSize, shadowTransport.peerSampleSize);
});

test('min sample fallback: LOCAL 후보가 5개 미만이면 SIGUNGU로 재시도한다(§14-16 hotfix 그대로 재사용)', () => {
  const target = master({ aptSeq: 'TARGET2', umdName: 'LONELY_DONG' });
  const others: MasterRow[] = [];
  const locationByAptSeq = new Map<string, LocationFeatureWithStationName>([loc('TARGET2', 300)]);
  const qualityByAptSeq = new Map<string, QualityResult>([['TARGET2', fullQuality('TARGET2')]]);
  for (let i = 0; i < 8; i++) {
    const aptSeq = `SIGUNGU_PEER_${i}`;
    others.push(master({ aptSeq, umdName: 'OTHER_DONG' }));
    locationByAptSeq.set(aptSeq, loc(aptSeq, 200 + i * 10)[1]);
    qualityByAptSeq.set(aptSeq, fullQuality(aptSeq));
  }
  const cohort = [target, ...others];
  const masterByAptSeq = new Map(cohort.map((m) => [m.aptSeq, m]));
  const ds: BusanDataset = { masters: cohort, masterByAptSeq, locationByAptSeq, marketTxByAptSeq: new Map(), qualityByAptSeq, cohortsBySggCd: new Map([['26140', cohort]]) };
  const outcome = computeScoreForTarget(target, cohort, ds, 'SHADOW_FILTERED');
  const transport = outcome.categories.find((c) => c.key === 'transport')!;
  assert.equal(transport.peerLevel, 'SIGUNGU'); // LOCAL 후보 1개뿐(<5) -> SIGUNGU로 폴백
  assert.equal(transport.status, 'SCORED');
});

test('countCrossInversions: lowerIsBetter에서 raw가 명백히 나쁜데 score가 더 높은 pair만 정확히 센다', () => {
  const entries = [
    { aptSeq: 'A', raw: 100, score: 50 }, // A: 가깝지만(좋음) 점수 낮음
    { aptSeq: 'B', raw: 400, score: 80 }, // B: 멀지만(나쁨) 점수 높음 -> A/B는 inversion
    { aptSeq: 'C', raw: 500, score: 20 }, // C: 멀고 점수도 낮음 -> inversion 아님
  ];
  const result = countCrossInversions(entries, 'lowerIsBetter', [200, 500]);
  assert.equal(result[0].count, 1); // gap>=200: (A,B)만 해당(400-100=300>=200, score 50<80)
  assert.equal(result[1].count, 0); // gap>=500: 어떤 쌍도 raw gap이 500 이상이 아님
});

test('countCrossInversions: higherIsBetter에서 raw가 더 많은데 score가 더 낮은 pair를 센다', () => {
  const entries = [
    { aptSeq: 'A', raw: 10, score: 30 },
    { aptSeq: 'B', raw: 2, score: 90 },
  ];
  const result = countCrossInversions(entries, 'higherIsBetter', [5]);
  assert.equal(result[0].count, 1); // A가 raw 8만큼 더 많은데 score는 더 낮음
});

test('결정론적 출력: 동일 입력에 동일 순서로 두 번 호출해도 동일 결과(랜덤/시간 의존 없음)', () => {
  const { ds, target, cohort } = buildDataset({ pollutedCount: 2 });
  const first = computeScoreForTarget(target, cohort, ds, 'SHADOW_FILTERED');
  const second = computeScoreForTarget(target, cohort, ds, 'SHADOW_FILTERED');
  assert.deepEqual(first, second);
});
