// PERCEIVED_PERFORMANCE_V2_DATAFLOW §2/§4 — 아파트 상세의 **canonical 좌표** 해석.
//
// 왜 필요한가(감사 V1 실측): 상세페이지의 인프라 카드 9개가 각자
// `geocoder.addressSearch("지역명 + 단지명")`을 호출했고, 그 문자열은 주소가 아니라서
// **10/10이 total_count=0으로 실패**했다. 그 뒤 각 카드가 `ps.keywordSearch()`로
// 폴백해 **결과 75건 중 첫 번째를 좌표로 채택**했다 — 이름만으로 다른 장소를 집을 수
// 있는 구조이며 AGENTS.md의 "이름만으로 아파트를 재식별하지 않는다"에 정면으로 어긋난다.
//
// 이 모듈은 그 런타임 추측을 **저장된 canonical 좌표 조회**로 대체한다.
// 원천은 ApartmentMaster.latitude/longitude 하나뿐이다(Kakao geocoding 결과를 적재
// 시점에 검증해 저장한 값, schema 주석 M2 §I — 행정구역 대표좌표는 저장하지 않는다).
// 지도 마커 경로(map-marker-coords.ts)가 이미 같은 원천을 쓰고 있어 화면 간 좌표가
// 어긋나지 않는다.
//
// 절대 하지 않는 것:
//   - 이름만으로 다른 동/다른 구의 단지를 집기
//   - Kakao 검색 결과 첫 번째를 좌표로 채택하기
//   - 좌표가 없을 때 근처 단지나 행정구역 중심으로 대체하기
// 좌표를 못 찾으면 그 사실을 그대로 돌려준다(NO_COORDINATE). 틀린 위치는 위치가
// 없는 것보다 나쁘다(map-embed-logic.ts §6과 같은 원칙).
import type { PrismaClient } from '@prisma/client';
import { normalizeAptName } from './apt-name-match';
import { isRenderableCoordinate } from './kakao/map-embed-logic';

/** 어떤 identity로 좌표를 찾았는지 — 응답에 그대로 실어 추적 가능하게 한다. */
export type CanonicalCoordSource =
  /** aptSeq 정확 일치. MOLIT canonical id라 가장 강하다. */
  | 'APT_SEQ'
  /** 같은 시군구(sggCd) + 같은 법정동(umdName) + 정규화 단지명 완전일치.
   *  dong 경계를 절대 넘지 않는다 — map-marker-coords.ts의 1순위 규칙과 동일하다. */
  | 'DONG_NAME_EXACT';

export type CanonicalCoordReason =
  /** 신뢰할 수 있는 identity(aptSeq 또는 lawdCd+dong+name)가 요청에 없다. */
  | 'NO_IDENTITY'
  /** identity는 있으나 ApartmentMaster에 해당 단지가 없다. */
  | 'NO_MASTER'
  /** master는 찾았으나 좌표가 비었거나 좌표로 쓸 수 없는 값이다. */
  | 'MASTER_WITHOUT_COORDS';

export interface CanonicalCoord {
  lat: number;
  lng: number;
  aptSeq: string | null;
  source: CanonicalCoordSource;
  /** ApartmentMaster.geocodeQuality 원본('exact' | 'normalized' | 'failed' | null). */
  geocodeQuality: string | null;
  /** 건축물대장 지번주소 완성형. 로드뷰/지도 표기에 쓸 수 있는 진짜 주소다. */
  jibunAddress: string | null;
}

export type CanonicalCoordResult =
  | { status: 'RESOLVED'; coordinate: CanonicalCoord }
  | { status: 'NO_COORDINATE'; reason: CanonicalCoordReason };

export interface CanonicalCoordQuery {
  /** 이 요청에서 검증된 canonical aptSeq(있으면 최우선). */
  aptSeq?: string | null;
  /** 시군구 코드(= ApartmentMaster.sggCd). */
  lawdCd?: string | null;
  /** 법정동명(= ApartmentMaster.umdName). */
  dong?: string | null;
  /** 단지명 — 정규화 후 **완전일치**에만 쓴다(부분일치/유사도 매칭 없음). */
  name?: string | null;
}

/** ApartmentMaster에서 좌표 판정에 필요한 최소 필드만. */
type MasterCoordCandidate = {
  aptSeq: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodeQuality: string | null;
  jibunAddress: string | null;
};

/**
 * 조회된 master row를 결과로 바꾼다(순수 함수 — DB 없이 테스트 가능).
 * 좌표가 렌더 가능한 값이 아니면 RESOLVED로 만들지 않는다(0,0 널섬 포함).
 */
export function toCanonicalCoordResult(
  master: MasterCoordCandidate | null,
  source: CanonicalCoordSource
): CanonicalCoordResult {
  if (!master) return { status: 'NO_COORDINATE', reason: 'NO_MASTER' };
  if (!isRenderableCoordinate(master.latitude, master.longitude)) {
    return { status: 'NO_COORDINATE', reason: 'MASTER_WITHOUT_COORDS' };
  }
  return {
    status: 'RESOLVED',
    coordinate: {
      lat: master.latitude as number,
      lng: master.longitude as number,
      aptSeq: master.aptSeq,
      source,
      geocodeQuality: master.geocodeQuality,
      jibunAddress: master.jibunAddress,
    },
  };
}

const MASTER_COORD_SELECT = {
  aptSeq: true,
  latitude: true,
  longitude: true,
  geocodeQuality: true,
  jibunAddress: true,
} as const;

/**
 * §2 — canonical 좌표를 **한 번** 해석한다. 상세 라우트가 이 결과를 응답에 실어
 * 내려보내고, 클라이언트의 모든 위치 소비자(교통/주거환경/버스/지도/로드뷰)가
 * 그 하나를 재사용한다.
 *
 * 순서:
 *   1. aptSeq 정확 일치 (MOLIT canonical id)
 *   2. sggCd + umdName + 정규화 단지명 완전일치 (동 경계 안에서만)
 * 둘 다 없으면 NO_COORDINATE. **이름만으로 지역을 넘어 찾지 않는다.**
 */
export async function resolveCanonicalCoords(
  db: Pick<PrismaClient, 'apartmentMaster'>,
  query: CanonicalCoordQuery
): Promise<CanonicalCoordResult> {
  const aptSeq = query.aptSeq?.trim() || '';
  const lawdCd = query.lawdCd?.trim() || '';
  const dong = query.dong?.trim() || '';
  const normalizedName = normalizeAptName(query.name || '');

  if (aptSeq) {
    const byAptSeq = await db.apartmentMaster.findUnique({
      where: { aptSeq },
      select: MASTER_COORD_SELECT,
    });
    // aptSeq로 찾았는데 좌표가 없더라도 **이름 검색으로 내려가지 않는다** —
    // 그건 "이 단지의 좌표"가 아니라 "이름이 비슷한 무언가의 좌표"가 될 수 있다.
    if (byAptSeq) return toCanonicalCoordResult(byAptSeq, 'APT_SEQ');
  }

  if (lawdCd && dong && normalizedName) {
    const byDongName = await db.apartmentMaster.findFirst({
      where: { sggCd: lawdCd, umdName: dong, normalizedName },
      select: MASTER_COORD_SELECT,
    });
    return toCanonicalCoordResult(byDongName, 'DONG_NAME_EXACT');
  }

  return { status: 'NO_COORDINATE', reason: aptSeq ? 'NO_MASTER' : 'NO_IDENTITY' };
}
