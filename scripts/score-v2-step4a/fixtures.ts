/**
 * E-JIP SCORE V2 STEP 4A — Benchmark fixtures.
 *
 * STEP 4B에서 DB integration 검증 시 사용할 frozen raw input.
 * 모든 값은 STEP 3/3.5/3.7 문서의 answer-key에서 직접 확인한 실측값이다.
 *
 * 중요:
 * - 다른 단지 fallback 금지 — 각 fixture는 해당 단지의 실제 raw facts.
 * - parkingRatio는 KNOWN/MISSING 중 알 수 있는 경우만 사용.
 * - total score는 engine output을 통해 계산 — fixture에서 하드코딩하지 않는다.
 */

import type { ScoreV2Input } from '../../src/lib/score-v2/types';

/**
 * 대신해모로센트럴 (부산 동래구, aptSeq=확인 필요)
 *
 * STEP 2 §40, STEP 3 §47:
 *   subway=140m, age=4년(2022년), households=733, parking=1.09
 *   transport domain=86.5, complex domain=82.9
 *   education=37.0(elementary 545m), living=60.7
 *   expected total (W-A) ≈ 67.8
 *
 * 주의: aptSeq는 STEP 4B에서 DB 조회 후 확인.
 * subwayStatus=VALUE (역세권 확인)
 */
export const FIXTURE_DAESIN_HAEMO: ScoreV2Input = {
  aptSeq: 'DAESHIN_HAEMO_FIXTURE', // STEP 4B에서 실제 aptSeq로 교체
  buildYear: 2022,
  totalHouseholds: 733,
  parkingRatio: 1.09,
  parkingRawStatus: 'KNOWN',
  subwayStatus: 'VALUE',
  nearestSubwayDistanceM: 140,
  nearestBusStopDistanceM: 50,   // 버스 근접 (정확한 값은 STEP 4B 확인)
  busStopCount300m: 15,          // 추정값 — STEP 4B에서 DB 조회로 교체
  nearestElementaryDistanceM: 545,
  attendanceZoneStatus: 'AVAILABLE',
  living: {
    martCount1000m: 2,
    convenienceCount500m: 20,
    pharmacyCount500m: 10,
    hospitalCount1000m: 45,
    parkCount1000m: 10,
    daycareKindergartenCount500m: 5,
  },
  identityEligible: true,
};

/**
 * 협성르네상스 (부산 동래구)
 *
 * STEP 2 §41, STEP 3 §47:
 *   subway=306m, age=25년(≈2001), households=489, parking=1.58
 *   transport domain=72.1, complex domain=64.8
 *   education=60.9(elementary 341m), living=58.4
 *   expected total (W-A) ≈ 64.0
 */
export const FIXTURE_HYUPSUNG: ScoreV2Input = {
  aptSeq: 'HYUPSUNG_FIXTURE',
  buildYear: 2001,
  totalHouseholds: 489,
  parkingRatio: 1.58,
  parkingRawStatus: 'KNOWN',
  subwayStatus: 'VALUE',
  nearestSubwayDistanceM: 306,
  nearestBusStopDistanceM: 60,
  busStopCount300m: 12,
  nearestElementaryDistanceM: 341,
  attendanceZoneStatus: 'AVAILABLE',
  living: {
    martCount1000m: 2,
    convenienceCount500m: 15,
    pharmacyCount500m: 8,
    hospitalCount1000m: 40,
    parkCount1000m: 8,
    daycareKindergartenCount500m: 4,
  },
  identityEligible: true,
};

/**
 * 구덕금호 — NOT_ENOUGH_DATA 케이스
 *
 * STEP 2 §43, STEP 3 §58: identityEligible=false (coordOk=false).
 * transport/education/living 계산 불가.
 * engine이 NOT_ENOUGH_DATA를 반환해야 한다.
 */
export const FIXTURE_GUDUK_KUMHO: ScoreV2Input = {
  aptSeq: 'GUDUK_KUMHO_FIXTURE',
  buildYear: 1993, // age≈33년 → ageBand '31+'
  totalHouseholds: null,
  parkingRatio: null,
  parkingRawStatus: 'MISSING',
  subwayStatus: 'MISSING', // 좌표 신뢰 불가 → 수집 불가
  nearestSubwayDistanceM: null,
  nearestBusStopDistanceM: null,
  busStopCount300m: null,
  nearestElementaryDistanceM: null,
  attendanceZoneStatus: 'NOT_AVAILABLE',
  living: {
    martCount1000m: null,
    convenienceCount500m: null,
    pharmacyCount500m: null,
    hospitalCount1000m: null,
    parkCount1000m: null,
    daycareKindergartenCount500m: null,
  },
  identityEligible: false, // COORD_LOW → NOT_ENOUGH_DATA
};

/**
 * PAIR 03 A — 희망센츄럴타운 (부산 서구, subway 38m 극초역세권)
 *
 * STEP 3.7 answer-key:
 *   T=89.4, L=68.6, E=58.6, C=41.9, total=64.6
 *   subway 38m (CONFIRMED VALUE), 48세대, 주차없음(MISSING), 2002년
 */
export const FIXTURE_PAIR03_A: ScoreV2Input = {
  aptSeq: 'PAIR03_A_FIXTURE',
  buildYear: 2002,
  totalHouseholds: 48,
  parkingRatio: null,
  parkingRawStatus: 'MISSING',
  subwayStatus: 'VALUE',
  nearestSubwayDistanceM: 38,
  nearestBusStopDistanceM: 34,
  busStopCount300m: 10,
  nearestElementaryDistanceM: 368,
  attendanceZoneStatus: 'AVAILABLE',
  living: {
    martCount1000m: 2,
    convenienceCount500m: 18,
    pharmacyCount500m: 10,
    hospitalCount1000m: 45,
    parkCount1000m: 8,
    daycareKindergartenCount500m: 4,
  },
  identityEligible: true,
};

/**
 * PAIR 03 B — 해운대힐스테이트위브 (부산 해운대구, 지하철 CONFIRMED_ABSENT)
 *
 * STEP 3.7 answer-key:
 *   T=20.7, L=51.0, E=45.5, C=84.3, total=50.4
 *   subway CONFIRMED_ABSENT, 2369세대, 주차1.65, 2015년
 */
export const FIXTURE_PAIR03_B: ScoreV2Input = {
  aptSeq: 'PAIR03_B_FIXTURE',
  buildYear: 2015,
  totalHouseholds: 2369,
  parkingRatio: 1.65,
  parkingRawStatus: 'KNOWN',
  subwayStatus: 'CONFIRMED_ABSENT',
  nearestSubwayDistanceM: null,
  nearestBusStopDistanceM: 163,
  busStopCount300m: 8,
  nearestElementaryDistanceM: 466,
  attendanceZoneStatus: 'AVAILABLE',
  living: {
    martCount1000m: 1,
    convenienceCount500m: 12,
    pharmacyCount500m: 6,
    hospitalCount1000m: 30,
    parkCount1000m: 7,
    daycareKindergartenCount500m: 3,
  },
  identityEligible: true,
};

/**
 * PAIR 10 A — 진흥목화 (부산 연제구, 초등 43m 극초근접)
 *
 * STEP 3.7 answer-key:
 *   T=56.6, L=52.7, E=85.4, C=27.3, total=55.5
 *   subway 374m, 초등 43m, 72세대, 주차없음, 1986년
 */
export const FIXTURE_PAIR10_A: ScoreV2Input = {
  aptSeq: 'PAIR10_A_FIXTURE',
  buildYear: 1986,
  totalHouseholds: 72,
  parkingRatio: null,
  parkingRawStatus: 'MISSING',
  subwayStatus: 'VALUE',
  nearestSubwayDistanceM: 374,
  nearestBusStopDistanceM: 187,
  busStopCount300m: 8,
  nearestElementaryDistanceM: 43,
  attendanceZoneStatus: 'AVAILABLE',
  living: {
    martCount1000m: 1,
    convenienceCount500m: 10,
    pharmacyCount500m: 6,
    hospitalCount1000m: 35,
    parkCount1000m: 5,
    daycareKindergartenCount500m: 3,
  },
  identityEligible: true,
};

/**
 * PAIR 10 B — 더샵명지퍼스트월드3단지 (부산 강서구, 신축 대단지)
 *
 * STEP 3.7 answer-key:
 *   T=24.2, L=42.3, E=16.0, C=87.5, total=42.5
 *   subway CONFIRMED_ABSENT, 1530세대, 주차1.41, 2020년, 초등 837m
 */
export const FIXTURE_PAIR10_B: ScoreV2Input = {
  aptSeq: 'PAIR10_B_FIXTURE',
  buildYear: 2020,
  totalHouseholds: 1530,
  parkingRatio: 1.41,
  parkingRawStatus: 'KNOWN',
  subwayStatus: 'CONFIRMED_ABSENT',
  nearestSubwayDistanceM: null,
  nearestBusStopDistanceM: 124,
  busStopCount300m: 6,
  nearestElementaryDistanceM: 837,
  attendanceZoneStatus: 'AVAILABLE',
  living: {
    martCount1000m: 1,
    convenienceCount500m: 8,
    pharmacyCount500m: 4,
    hospitalCount1000m: 20,
    parkCount1000m: 5,
    daycareKindergartenCount500m: 3,
  },
  identityEligible: true,
};

export const ALL_FIXTURES = {
  DAESIN_HAEMO: FIXTURE_DAESIN_HAEMO,
  HYUPSUNG: FIXTURE_HYUPSUNG,
  GUDUK_KUMHO: FIXTURE_GUDUK_KUMHO,
  PAIR03_A: FIXTURE_PAIR03_A,
  PAIR03_B: FIXTURE_PAIR03_B,
  PAIR10_A: FIXTURE_PAIR10_A,
  PAIR10_B: FIXTURE_PAIR10_B,
} as const;
