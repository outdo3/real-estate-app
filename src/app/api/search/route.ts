import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveApartmentViaKakaoAlias } from '@/lib/search-alias-fallback';
import { rankApartmentMatches, normalizeSearchKeyword } from '@/lib/search-ranking';
import { isPublicRegionAllowed, publicAllowedLawdCds } from '@/lib/region/enablement';
// OFFICETEL_V1 STEP 4B §1/§2 — 기존 아파트 검색을 대체하지 않고 결과 종류만 추가한다.
import { searchOfficetels, type OfficetelSearchResult } from '@/lib/officetel/search-read';

// Define our result types
export type RegionSearchResult = {
  type: 'REGION';
  name: string;      // e.g. "연산동"
  sido: string;      // "부산광역시"
  sigungu: string;   // "연제구"
  dong: string;      // "연산동"
  lawdCd: string;    // "26470" (연제구 법정동코드)
};

export type ApartmentSearchResult = {
  type: 'APARTMENT';
  apartmentId: number;
  name: string;
  lawdCd: string | null;
  dong: string | null;
  jibun: string | null;
  aptSeq: string | null;
  lat: number | null;
  lng: number | null;
  totalHouseholds: number | null;
  completionYear: number | null;
  /** DB 문자열 매칭이 아니라 카카오 POI 별칭 좌표 역매칭으로 찾은 경우에만 채워짐(§14 fallback) */
  matchNote?: string | null;
};

export type { OfficetelSearchResult };

export type UnifiedSearchResult = {
  regions: RegionSearchResult[];
  apartments: ApartmentSearchResult[];
  /** OFFICETEL_V1 STEP 4B — 기존 소비처는 이 키를 무시해도 그대로 동작한다(추가만). */
  officetels: OfficetelSearchResult[];
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ regions: [], apartments: [], officetels: [] });
  }

  const keyword = q.trim();
  const normalizedKeyword = normalizeSearchKeyword(keyword);

  // SEOUL_BETA_EXPOSURE_LEAK_CLOSE_V1 — 승인되지 않은 서울은 검색 결과에 나오지 않는다.
  //
  // 이 테이블은 오랫동안 부산 전용(약 3,400행)이었고 위 주석의 take 제거 근거도 거기서 나왔다.
  // 지금은 서울 master 6,843행이 함께 들어 있어, 필터가 없으면 미출시 지역(강남 포함)이
  // 그대로 공개 검색에 노출된다. 표시 이름이 아니라 **canonical 지역 코드(sggCd)** 로만 거른다.
  //
  // GYEONGGI_PUBLIC_EXPOSURE_GUARD_V1 — 위 deny-list(차단된 서울 제외)는 서울이 아닌 지역을 전부
  // 통과시켰다. 경기 master가 생기면 그대로 검색에 실린다. 이제 **공개된 구만** 싣는다(allowlist).
  // sggCd가 null이거나 registry에 없는 행은 IN에 걸리지 않아 자동으로 빠진다.
  const regionScope = { sggCd: { in: [...publicAllowedLawdCds('search')] } };

  // Run Region distinct, Apartment and Officetel search in parallel.
  // 오피스텔 쿼리는 5,056행 테이블 하나라 기존 두 쿼리와 나란히 돌려도 지연이 늘지 않는다.
  // 실패해도 아파트/지역 결과를 죽이지 않는다 — 오피스텔만 빈 배열로 축소된다(§1 무회귀).
  const [regionRows, rawApartments, officetels] = await Promise.all([
    prisma.apartmentMaster.findMany({
      where: {
        umdName: {
          contains: normalizedKeyword
        },
        ...regionScope,
      },
      distinct: ['sido', 'sigungu', 'sggCd', 'umdName'],
      select: { sido: true, sigungu: true, sggCd: true, umdName: true },
      take: 5
    }),
    prisma.apartmentMaster.findMany({
      where: {
        OR: [
          { normalizedName: { contains: normalizedKeyword } },
          { name: { contains: normalizedKeyword } }
        ],
        ...regionScope,
      },
      // BUSAN_APARTMENT_SEARCH_COVERAGE_PERFORMANCE_V1 §7/§37 감사 결과 — take:50에
      // 걸려 이 시점에서 이미 잘려나가는 실제 사례를 발견했다("현대"/"동원"/"한신" 같은
      // 흔한 단지명은 Busan 안에서만도 50건을 넘는 substring 매칭이 있다). 이 테이블은
      // 전체 약 3,400행 규모(Busan 전용)라 take 제거는 성능에 사실상 영향이 없고
      // (벤치마크로 검증), exact-match가 하위 랭킹에서 잘리는 문제를 근본적으로
      // 없앤다 — 대신 아래에서 tier 랭킹 후 상위 15개만 응답한다.
      select: {
        id: true,
        name: true,
        normalizedName: true,
        sggCd: true,
        umdName: true,
        jibun: true,
        aptSeq: true,
        buildYear: true,
        totalHouseholds: true,
      }
    }),
    // 오피스텔도 같은 allowlist를 따른다(현재 원천은 부산 전용이라 결과 변화 없음).
    searchOfficetels(keyword).then((rows) => rows.filter((o) => isPublicRegionAllowed(o.sggCd, 'search'))).catch((e) => {
      console.error('[search] officetel 검색 실패 — 아파트/지역 결과는 그대로 반환한다', e);
      return [] as OfficetelSearchResult[];
    })
  ]);

  const regions: RegionSearchResult[] = regionRows.map(r => ({
    type: 'REGION',
    name: `${r.sido} ${r.sigungu} ${r.umdName}`.trim(),
    sido: r.sido || '',
    sigungu: r.sigungu || '',
    dong: r.umdName || '',
    lawdCd: r.sggCd || ''
  }));

  // §11 SEARCH RANKING RULE — src/lib/search-ranking.ts 참고. 예전에는 household 수만
  // 으로 정렬해 정확히 일치하는 작은 단지가 이름이 겹치는 더 큰 단지들에 밀려 top-15
  // 밖으로 잘려나가는 실제 사례가 있었다(§7 감사에서 확인: "현대"/"경동" 등 50건 이상).
  let topApartments = rankApartmentMatches(rawApartments, normalizedKeyword, 15);

  // §14/§26 ALIAS FALLBACK — DB contains 매칭이 완전히 0건일 때만, 이미 앱 전역에서
  // 쓰는 카카오 키워드 검색으로 "공식 등록명과 다른 통용 별칭" 케이스를 좌표 기반으로
  // 역매칭한다(src/lib/search-alias-fallback.ts 참고, 반경 80m + 카테고리 필터 +
  // 유일 후보 조건 — 못 찾으면 그대로 no-result, 억지 fallback 없음). 정상적인 DB 매칭
  // 경로에는 전혀 영향 없음(외부 API는 이 드문 경우에만, 키워드당 최대 1회).
  let aliasNote: string | null = null;
  if (topApartments.length === 0) {
    const aliasMatch = await resolveApartmentViaKakaoAlias(keyword);
    if (aliasMatch) {
      topApartments = [{
        id: aliasMatch.id,
        name: aliasMatch.name,
        normalizedName: aliasMatch.name,
        sggCd: aliasMatch.sggCd,
        umdName: aliasMatch.umdName,
        jibun: aliasMatch.jibun,
        aptSeq: aliasMatch.aptSeq,
        buildYear: aliasMatch.buildYear,
        totalHouseholds: aliasMatch.totalHouseholds,
      }];
      aliasNote = aliasMatch.matchedViaAlias;
    }
  }

  const aptSeqs = topApartments.map(a => a.aptSeq).filter(Boolean) as string[];
  const locations = await prisma.apartmentLocationFeature.findMany({
    where: {
      aptSeq: { in: aptSeqs }
    },
    select: {
      aptSeq: true,
      latitude: true,
      longitude: true
    }
  });

  const locationMap = new Map(locations.map(l => [l.aptSeq, l]));

  // SEOUL_MOBILE_BETA_LAUNCH_V1 — `apartment_location_features`는 부산 전용이라 서울 단지는 좌표가 null로
  // 내려가 지도가 (0,0)으로 이동했다. 입지 피처가 없는 단지만 **같은 aptSeq의** master 좌표로 채운다
  // (지도 마커가 이미 쓰는 좌표다). 피처가 있는 단지는 기존 좌표 그대로다. 없으면 null — 지어내지 않는다.
  const missingCoordSeqs = aptSeqs.filter((s) => !locationMap.has(s));
  if (missingCoordSeqs.length > 0) {
    const masterCoords = await prisma.apartmentMaster.findMany({
      where: { aptSeq: { in: missingCoordSeqs }, latitude: { not: null }, longitude: { not: null } },
      select: { aptSeq: true, latitude: true, longitude: true },
    });
    for (const m of masterCoords) {
      if (m.aptSeq && m.latitude != null && m.longitude != null) {
        locationMap.set(m.aptSeq, { aptSeq: m.aptSeq, latitude: m.latitude, longitude: m.longitude });
      }
    }
  }

  const apartments: ApartmentSearchResult[] = topApartments.map(a => {
    const loc = a.aptSeq ? locationMap.get(a.aptSeq) : null;
    return {
      type: 'APARTMENT',
      apartmentId: a.id,
      name: a.name,
      lawdCd: a.sggCd,
      dong: a.umdName,
      jibun: a.jibun,
      aptSeq: a.aptSeq,
      lat: loc ? loc.latitude : null,
      lng: loc ? loc.longitude : null,
      totalHouseholds: a.totalHouseholds,
      completionYear: a.buildYear,
      matchNote: aliasNote,
    };
  });

  return NextResponse.json({ regions, apartments, officetels });
}
