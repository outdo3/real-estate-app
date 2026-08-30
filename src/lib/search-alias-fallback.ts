// BUSAN_APARTMENT_SEARCH_COVERAGE_PERFORMANCE_V1 — DB contains-매칭이 0건일 때만 쓰는
// 최후 폴백. 실측 사례(경동마리나): 건축물대장/MOLIT 공식 등록명은 "경동"이지만,
// 카카오맵 POI(부동산 > 주거시설 > 아파트 카테고리)는 "경동마리나아파트"라는 통용
// 별칭으로 등록돼 있고, 그 좌표가 ApartmentMaster의 "경동"(aptSeq 26350-2) 좌표와
// 소수점 단위까지 정확히 일치함을 확인했다(§4 데이터 트레이스). 즉 우리 DB에는 이
// 별칭 문자열 자체가 어디에도 없어(ApartmentMaster/Apartment/ApartmentTradeHistory
// 전부 "경동"으로만 등록) 아무리 normalize/contains를 개선해도 문자열 매칭만으로는
// 못 찾는다 — 좌표 기반 역매칭만이 유일한 다리다.
//
// 안전장치(§10/§25 원칙 — "비슷한 이름 단지를 억지로 fallback하지 않는다",
// "못 찾으면 NO RESULT가 잘못된 단지보다 낫다"):
//   1) 카카오 POI 카테고리가 정확히 "...주거시설 > 아파트"인 것만 후보로 본다
//      (상가/학원/부동산중개업/충전소 등 같은 문자열을 포함하는 무관한 POI 제외 — 실측
//      확인, "경동마리나" 검색 시 7개 POI 중 4개가 비주거 카테고리였음).
//   2) 후보 POI 좌표에서 반경 80m 이내에 있는 ApartmentMaster row가 정확히 1개일
//      때만 채택한다. 0개면 매칭 실패(그대로 no-result), 2개 이상이면 모호하므로
//      채택하지 않는다(추측으로 하나를 고르지 않음).
//   3) 결과로 반환하는 identity(aptSeq/name/dong/jibun 등)는 전부 ApartmentMaster의
//      canonical 값이다 — 사용자가 입력한 별칭 문자열을 identity에 섞지 않는다.
//   4) 키워드별 in-memory 캐시로 동일 세션 내 반복 호출을 막는다(geocode-apt.ts의
//      aptGeoCache와 동일 패턴) — 매 keystroke가 아니라 "DB 0건"이라는 드문 경우에만,
//      그것도 키워드당 최대 1회만 카카오를 호출한다.

import { prisma } from './prisma';

export interface AliasFallbackCandidate {
  id: number;
  aptSeq: string | null;
  name: string;
  sggCd: string | null;
  umdName: string | null;
  jibun: string | null;
  buildYear: number | null;
  totalHouseholds: number | null;
  latitude: number;
  longitude: number;
  /** 사용자에게 "왜 이 결과가 나왔는지" 보여주기 위한 카카오 POI 표시명(별도 저장 없음, 이번 응답에서만 사용) */
  matchedViaAlias: string;
}

const fallbackCache = new Map<string, AliasFallbackCandidate | null>();
const RADIUS_METERS = 80;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function resolveApartmentViaKakaoAlias(keyword: string): Promise<AliasFallbackCandidate | null> {
  if (fallbackCache.has(keyword)) return fallbackCache.get(keyword)!;

  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!kakaoKey) {
    fallbackCache.set(keyword, null);
    return null;
  }

  try {
    const headers = {
      Authorization: `KakaoAK ${kakaoKey}`,
      KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
      Origin: 'http://localhost:3000',
    };
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}`,
      { headers, signal: AbortSignal.timeout(2500) }
    );
    if (!res.ok) {
      fallbackCache.set(keyword, null);
      return null;
    }
    const data = await res.json();
    const documents: any[] = data.documents || [];
    const aptDocs = documents.filter((d) => (d.category_name || '').includes('주거시설 > 아파트'));
    if (aptDocs.length === 0) {
      fallbackCache.set(keyword, null);
      return null;
    }

    const masterRows = await prisma.apartmentMaster.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      select: {
        id: true, aptSeq: true, name: true, sggCd: true, umdName: true,
        jibun: true, buildYear: true, totalHouseholds: true, latitude: true, longitude: true,
      },
    });

    for (const doc of aptDocs) {
      const poiLat = parseFloat(doc.y);
      const poiLng = parseFloat(doc.x);
      if (!Number.isFinite(poiLat) || !Number.isFinite(poiLng)) continue;

      const withinRadius = masterRows.filter(
        (m) => haversineMeters(poiLat, poiLng, m.latitude!, m.longitude!) <= RADIUS_METERS
      );
      if (withinRadius.length === 1) {
        const m = withinRadius[0];
        const result: AliasFallbackCandidate = {
          id: m.id, aptSeq: m.aptSeq, name: m.name, sggCd: m.sggCd, umdName: m.umdName,
          jibun: m.jibun, buildYear: m.buildYear, totalHouseholds: m.totalHouseholds,
          latitude: m.latitude!, longitude: m.longitude!, matchedViaAlias: doc.place_name,
        };
        fallbackCache.set(keyword, result);
        return result;
      }
      // 0개 또는 2개 이상(모호함) — 이 POI는 채택하지 않고 다음 POI 후보로.
    }

    fallbackCache.set(keyword, null);
    return null;
  } catch {
    fallbackCache.set(keyword, null);
    return null;
  }
}
