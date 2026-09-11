import { haversineMeters } from '@/lib/geo-bounding-box';

/**
 * APT_DETAIL_DEFAULT_ALL_TRUST_FIX_V1 §7 — 리포트의 "가장 가까운 초등학교" 해석.
 *
 * ── 왜 School 테이블인가 ────────────────────────────────────────────────────
 * 리포트는 지금까지 `ApartmentLocationFeature.nearestElementaryDistanceM`(Kakao 키워드
 * 검색 기반)만 들고 있었다. 그 컬럼에는 **학교 이름이 없다** — 수집 단계에서 거리만
 * 저장했기 때문이다. 그래서 리포트가 "초등학교 341m"처럼 이름 없는 거리만 보여줬다.
 *
 * School 테이블은 NEIS 원천이고 좌표가 OFFICIAL_POINT이며 부산 초등학교 305곳이
 * 전부 좌표를 갖고 있다. 즉 **이름과 거리를 같은 출처에서 함께** 얻을 수 있다.
 *
 * ── 출처를 섞지 않는다 ──────────────────────────────────────────────────────
 * NEIS 이름에 Kakao 거리를 붙이지 않는다. 두 출처가 가리키는 학교가 다를 수 있어
 * "OO초등학교 · (다른 학교까지의) 341m"라는 거짓 조합이 만들어질 수 있다.
 * 이름을 쓸 때는 거리도 같은 행에서 계산한 값을 쓴다.
 *
 * 이름을 확인할 수 없으면 **지어내지 않고** null을 돌려준다. 호출부는 그때
 * 사실대로 "정보 없음"을 표시한다.
 */

export interface SchoolPoint {
  schoolName: string;
  latitude: number | null;
  longitude: number | null;
}

export interface NearestSchool {
  name: string;
  distanceM: number;
}

/**
 * 좌표가 있는 학교 중 가장 가까운 한 곳. 동점이면 이름 오름차순으로 결정적으로 고른다.
 * 아파트 좌표가 없거나 후보가 없으면 null(= 확인 불가).
 */
export function findNearestSchool(
  aptLat: number | null | undefined,
  aptLng: number | null | undefined,
  schools: readonly SchoolPoint[]
): NearestSchool | null {
  if (typeof aptLat !== 'number' || typeof aptLng !== 'number') return null;
  if (!Number.isFinite(aptLat) || !Number.isFinite(aptLng)) return null;

  let best: NearestSchool | null = null;
  for (const school of schools) {
    const { latitude, longitude, schoolName } = school;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (!schoolName) continue;

    const distanceM = Math.round(haversineMeters(aptLat, aptLng, latitude, longitude));
    if (
      best === null ||
      distanceM < best.distanceM ||
      (distanceM === best.distanceM && schoolName < best.name)
    ) {
      best = { name: schoolName, distanceM };
    }
  }
  return best;
}
