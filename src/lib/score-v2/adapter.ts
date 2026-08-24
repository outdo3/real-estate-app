/**
 * E-JIP SCORE V2 — Raw Input Adapter.
 *
 * 기존 V1 DB schema 및 V1 API 조회 결과를 V2 Pure Engine이
 * 요구하는 ScoreV2Input 형태로 안전하게 변환한다.
 *
 * 책임:
 * - 값 추정 및 가짜 데이터 생성(fallback) 절대 금지.
 * - null은 null로 유지.
 * - subway 4-state 판별 (location.qualityFlag 활용).
 * - parking 2-state 분리.
 */

import type { RawMasterInfo, RawLocationFeature } from '@/lib/apartment-score/server/types';
import type { ScoreV2Input, SubwayDataStatus, ParkingRawStatus, AttendanceZoneStatus } from './types';

export function adaptToV2Input(
  master: RawMasterInfo,
  location: RawLocationFeature | null
): ScoreV2Input {
  // ---- 1. Identity & Eligibility ----
  // 구덕금호 케이스 등 좌표나 identity가 신뢰 불가능하여 location feature 생성이
  // 아예 불가능했던 단지(location == null)는 identityEligible=false 로 간주한다.
  const identityEligible = location != null && master.sggCd != null;

  // ---- 2. Complex: Age, Scale, Parking ----
  const buildYear = master.buildYear ?? null;
  const totalHouseholds = master.totalHouseholds ?? null;

  let parkingRatio: number | null = null;
  let parkingRawStatus: ParkingRawStatus = 'MISSING';
  
  if (master.parkingCount != null && master.totalHouseholds != null && master.totalHouseholds > 0) {
    parkingRatio = master.parkingCount / master.totalHouseholds;
    parkingRawStatus = 'KNOWN';
  }

  // ---- 3. Transport: Subway 4-state & Bus ----
  let subwayStatus: SubwayDataStatus = 'MISSING';
  let nearestSubwayDistanceM: number | null = null;

  if (location) {
    if (location.nearestSubwayDistanceM != null) {
      subwayStatus = 'VALUE';
      nearestSubwayDistanceM = location.nearestSubwayDistanceM;
    } else if (location.qualityFlag === 'complete') {
      // API 호출이 정상(complete)이었으나 거리가 null → 반경 내 역이 없음을 확인
      subwayStatus = 'CONFIRMED_ABSENT';
    } else {
      // partial/실패 등으로 값을 모름
      subwayStatus = 'MISSING';
    }
  }

  const nearestBusStopDistanceM = location?.nearestBusStopDistanceM ?? null;
  const busStopCount300m = location?.busStopCount300m ?? null;

  // ---- 4. Education: Elementary straight-line & Attendance zone ----
  // location 컬렉터가 Kakao POI API로 조회한 거리이므로 "직선거리" (physical distance) 의미.
  const nearestElementaryDistanceM = location?.nearestElementaryDistanceM ?? null;
  
  // 통학구역(배정) 데이터는 아직 공식 DB에 완전하지 않으므로 V1/V2 모두 사용 불가.
  // 증거(Evidence)용 기본값 적용.
  const attendanceZoneStatus: AttendanceZoneStatus = 'NOT_AVAILABLE';

  // ---- 5. Living: POI counts ----
  const living = {
    martCount1000m: location?.martCount1000m ?? null,
    convenienceCount500m: location?.convenienceCount500m ?? null,
    pharmacyCount500m: location?.pharmacyCount500m ?? null,
    hospitalCount1000m: location?.hospitalCount1000m ?? null,
    parkCount1000m: location?.parkCount1000m ?? null,
    daycareKindergartenCount500m: location?.daycareKindergartenCount500m ?? null,
  };

  return {
    aptSeq: master.aptSeq,
    buildYear,
    totalHouseholds,
    parkingRatio,
    parkingRawStatus,
    subwayStatus,
    nearestSubwayDistanceM,
    nearestBusStopDistanceM,
    busStopCount300m,
    nearestElementaryDistanceM,
    attendanceZoneStatus,
    living,
    identityEligible,
  };
}
