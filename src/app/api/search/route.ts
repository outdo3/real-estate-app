import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveApartmentViaKakaoAlias } from '@/lib/search-alias-fallback';
import { rankApartmentMatches, normalizeSearchKeyword } from '@/lib/search-ranking';
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

  // Run Region distinct, Apartment and Officetel search in parallel.
  // 오피스텔 쿼리는 5,056행 테이블 하나라 기존 두 쿼리와 나란히 돌려도 지연이 늘지 않는다.
  // 실패해도 아파트/지역 결과를 죽이지 않는다 — 오피스텔만 빈 배열로 축소된다(§1 무회귀).
  const [regionRows, rawApartments, officetels] = await Promise.all([
    prisma.apartmentMaster.findMany({
      where: {
        umdName: {
          contains: normalizedKeyword
        }
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
        ]
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
    searchOfficetels(keyword).catch((e) => {
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
