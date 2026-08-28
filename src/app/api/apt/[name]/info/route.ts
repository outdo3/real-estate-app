import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchBuildingRegistryInfo, formatRatio, formatParking } from '@/lib/apt-building-info';
import { shouldAdoptFallbackUnitTypes } from '@/lib/apt-name-match';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const aptName = decodeURIComponent(name);

    const { searchParams } = new URL(request.url);
    const lawdCd = searchParams.get('lawdCd') || '11680';
    const dong = searchParams.get('dong') || '';
    const jibun = searchParams.get('jibun') || '';

    const info: Record<string, string> = {};

    // 1. 네이버 스크래핑 (기본 세대수, 준공연도 등) - 헤더 보강하여 차단 방지
    // 주의: 이 검색어에는 지역(동/구) 정보가 전혀 없다 — 검색 결과가 동명의 타 지역
    // 단지로 얼마든지 쏠릴 수 있다(실측: "금호어울림"으로 검색하면 부산 서구(256세대)가
    // 아닌 타 지역 단지의 "1,549세대"가 최상단에 잡힘). 그래서 여기서 바로 info에 쓰지
    // 않고 임시 변수에만 담아둔다 — 아래 2번에서 지번까지 정확히 지정해 조회하는
    // 건축물대장(registry) 값이 있으면 그걸 우선시키고, registry가 없을 때만 이 값을
    // 폴백으로 쓴다.
    // 네이버 스크래핑과 DB 캐시 조회는 서로 의존하지 않는 별개의 네트워크 호출이라
    // Promise.all로 동시에 실행한다 — 이전에는 순서대로 await해서 두 호출의 지연시간이
    // 그대로 더해졌다(상세페이지 카드 정보가 늦게 뜨는 원인 중 하나).
    const fetchNaverInfo = async (): Promise<{ households: string | null; approvalYear: string | null }> => {
      try {
        const query = encodeURIComponent(`${aptName} 아파트 정보`);
        const searchUrl = `https://search.naver.com/search.naver?query=${query}`;

        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
          },
          signal: AbortSignal.timeout(2500) // 2.5초 타임아웃 추가
        });

        if (!response.ok) return { households: null, approvalYear: null };
        const html = await response.text();
        const householdMatch = html.match(/(?:총\s*)?([0-9,]+)세대/);
        const yearMatch = html.match(/([0-9]{4})년\s*(?:준공|입주)/);
        return {
          households: householdMatch ? `${householdMatch[1]}세대` : null,
          approvalYear: yearMatch ? `${yearMatch[1]}년` : null,
        };
      } catch (e) {
        console.warn('Naver scraping failed', e);
        return { households: null, approvalYear: null };
      }
    };

    // dong이 빈 문자열/undefined일 수 있는데, @@unique([name, dong])는 값이 항상 같은
    // 형태여야 매칭된다(null과 ''는 SQL에서 서로 다른 값으로 취급됨) — 이 라우트 안에서는
    // 항상 빈 문자열로 통일해 upsert의 where/create가 서로 어긋나지 않게 한다.
    const dongKey = dong || '';
    type Registry = { parkingCount: number | null; far: number | null; bcr: number | null; totalHouseholds: number | null; approvalDate: string | null };
    let unitTypes: any[] | null = null;
    
    const fetchCachedRegistry = async (): Promise<Registry | null> => {
      try {
        // APT INFO IDENTITY HOTFIX V1 §IDENTITY_PRINCIPLE — 이 name+dong exact 조회가
        // 이 라우트에서 얻을 수 있는 가장 강한 identity다(요청 컨텍스트에 aptSeq가 없고,
        // 있었더라도 실측상 같은 건물의 표기 변형 row들이 같은 aptSeq를 공유하는 사례가
        // 확인돼 aptSeq만으로는 이 특정 케이스를 구분하지 못한다 — 문서 §7 참고).
        const cached = await prisma.apartment.findFirst({
          where: { name: aptName, dong: dongKey },
          include: { unitTypes: true }
        });

        if (cached) {
          unitTypes = cached.unitTypes;
        }

        if (cached && cached.parkingCount && cached.far && cached.bcr && cached.approvalDate) {
          return {
            parkingCount: cached.parkingCount,
            far: cached.far,
            bcr: cached.bcr,
            totalHouseholds: cached.totalHouseholds ?? null,
            approvalDate: cached.approvalDate,
          };
        }

        if (jibun) {
          // 이 조회는 name 제약이 전혀 없는 "dong+jibun만" 매칭이라(§NAMELESS_ADDRESS_
          // FALLBACK), 같은 주소의 다른 이름 표기 row를 얼마든지 집을 수 있다. 건축물대장
          // registry 필드(parkingCount/far/bcr/approvalDate/totalHouseholds)는 특정
          // 아파트명이 아니라 그 주소(동+지번)의 물리적 건물에 귀속된 사실이고
          // fetchBuildingRegistryInfo 자체도 아파트명이 아니라 lawdCd+dong+jibun으로
          // 조회하므로, 이 필드들을 이 fallback에서 보충하는 것은 안전하다(변경 없음).
          const byJibun = await prisma.apartment.findFirst({
            where: { dong: dongKey, jibun },
            include: { unitTypes: true }
          });

          // unitTypes(Unit Master)는 반대로 아파트 identity별로 실제 값이 다를 수 있는
          // 데이터다(실측: 서대신동3가 762의 "대신롯데캐슬"=8건 vs "대신롯데캐슬아파트"
          // =0건 — 같은 건물, 다른 이름 표기 row인데 Unit Master 적재 상태가 다르다).
          // 채택 여부 판단(STRONGER_RESULT PROTECTION + IDENTITY PROOF)은
          // shouldAdoptFallbackUnitTypes()에 위임한다(apt-name-match.ts, 단위 테스트됨).
          if (
            byJibun &&
            shouldAdoptFallbackUnitTypes({
              currentUnitTypesCount: unitTypes?.length ?? 0,
              fallbackName: byJibun.name,
              requestedAptName: aptName,
              fallbackUnitTypesCount: byJibun.unitTypes.length,
            })
          ) {
            unitTypes = byJibun.unitTypes;
          }

          if (byJibun && byJibun.parkingCount && byJibun.far && byJibun.bcr && byJibun.approvalDate) {
            return {
              parkingCount: byJibun.parkingCount,
              far: byJibun.far,
              bcr: byJibun.bcr,
              totalHouseholds: byJibun.totalHouseholds ?? null,
              approvalDate: byJibun.approvalDate,
            };
          }
        }
        return null;
      } catch (e) {
        console.warn('Apartment DB lookup failed', e);
        return null;
      }
    };

    // DATA_COVERAGE_FIX_V1 — legacy Apartment 캐시가 못 채운 필드를, 매번 외부
    // BuildingHUB를 라이브로 부르기 전에 이미 backfill된 ApartmentMaster(부산)에서
    // 먼저 채워본다(§23: PERSISTED MASTER → API → UI 우선, 페이지뷰마다 외부 API를
    // 재호출하는 구조를 줄인다). 이름으로 찾지 않는다 — lawdCd+dong+jibun(=지번,
    // 이미 legacy Apartment의 byJibun 조회가 신뢰하는 것과 동일한 정밀도의 identity)
    // 로만 조회한다. 채워지지 않은 필드만 보충하고, legacy가 이미 채운 값은 덮지 않는다.
    const fetchMasterRegistrySupplement = async (partial: Registry | null): Promise<Registry | null> => {
      if (!dong || !jibun) return partial;
      try {
        const master = await prisma.apartmentMaster.findFirst({
          where: { sggCd: lawdCd, umdName: dong, jibun },
        });
        if (!master) return partial;

        const useAprDay = master.useApprovalDate || '';
        const approvalDate = /^\d{8}$/.test(useAprDay) ? `${useAprDay.slice(0, 4)}년` : null;

        return {
          parkingCount: partial?.parkingCount ?? master.parkingCount ?? null,
          far: partial?.far ?? master.floorAreaRatio ?? null,
          bcr: partial?.bcr ?? master.buildingCoverageRatio ?? null,
          totalHouseholds: partial?.totalHouseholds ?? master.totalHouseholds ?? null,
          approvalDate: partial?.approvalDate ?? approvalDate,
        };
      } catch (e) {
        console.warn('ApartmentMaster supplement lookup failed', e);
        return partial;
      }
    };

    const [naverInfo, cachedRegistry] = await Promise.all([fetchNaverInfo(), fetchCachedRegistry()]);
    const naverHouseholds = naverInfo.households;
    const naverApprovalYear = naverInfo.approvalYear;
    let registry: Registry | null = cachedRegistry;

    const isFullyPopulated = (r: Registry | null): boolean =>
      !!r && !!r.parkingCount && !!r.far && !!r.bcr && !!r.totalHouseholds && !!r.approvalDate;

    if (!isFullyPopulated(registry)) {
      registry = await fetchMasterRegistrySupplement(registry);
    }

    if (!isFullyPopulated(registry)) {
      const live = await fetchBuildingRegistryInfo(aptName, lawdCd, dong, jibun);
      if (live) {
        // tier1(legacy 캐시)/tier2(ApartmentMaster)가 이미 채운 필드는 덮지 않고 병합한다
        // (live가 registry 전체를 대체하던 기존 동작은 registry가 항상 null 아니면 완전
        // 채움이었을 때만 안전했다 — 이제 tier2로 부분 채움 상태가 생길 수 있어 병합 필요).
        registry = {
          parkingCount: registry?.parkingCount ?? live.parkingCount,
          far: registry?.far ?? live.far,
          bcr: registry?.bcr ?? live.bcr,
          totalHouseholds: registry?.totalHouseholds ?? live.totalHouseholds,
          approvalDate: registry?.approvalDate ?? live.approvalDate,
        };
        if (live.mainPurpose) info['주용도'] = live.mainPurpose;
        if (live.parkingCount || live.far || live.bcr || live.totalHouseholds || live.approvalDate) {
          try {
            const upserted = await prisma.apartment.upsert({
              where: { name_dong: { name: aptName, dong: dongKey } },
              create: {
                name: aptName,
                dong: dongKey,
                lawdCd,
                jibun: jibun || undefined,
                parkingCount: live.parkingCount ?? undefined,
                far: live.far ?? undefined,
                bcr: live.bcr ?? undefined,
                totalHouseholds: live.totalHouseholds ?? undefined,
                approvalDate: live.approvalDate ?? undefined,
              },
              update: {
                ...(jibun ? { jibun } : {}),
                ...(live.parkingCount ? { parkingCount: live.parkingCount } : {}),
                ...(live.far ? { far: live.far } : {}),
                ...(live.bcr ? { bcr: live.bcr } : {}),
                ...(live.totalHouseholds ? { totalHouseholds: live.totalHouseholds } : {}),
                ...(live.approvalDate ? { approvalDate: live.approvalDate } : {}),
              },
            });
            // if newly created, unitTypes is empty anyway.
          } catch (e) {
            console.warn('Apartment DB upsert failed', e);
          }
        }
      }
    }

    if (registry?.totalHouseholds) {
      info['세대수'] = `${registry.totalHouseholds.toLocaleString('ko-KR')}세대`;
    } else if (naverHouseholds) {
      info['세대수'] = naverHouseholds;
    }

    if (registry?.approvalDate) {
      info['사용승인일'] = registry.approvalDate;
    } else if (naverApprovalYear) {
      info['사용승인일'] = naverApprovalYear;
    }

    if (registry?.parkingCount) {
      const totalHouseholds = info['세대수'] ? parseInt(info['세대수'].replace(/,/g, ''), 10) : null;
      info['총주차대수'] = formatParking(registry.parkingCount, totalHouseholds);
    }
    if (registry?.far) info['용적률'] = formatRatio(registry.far);
    if (registry?.bcr) info['건폐율'] = formatRatio(registry.bcr);

    return NextResponse.json({
      success: true,
      aptName,
      info: Object.keys(info).length > 0 ? info : null,
      unitTypes: Array.isArray(unitTypes) && (unitTypes as any[]).length > 0 ? unitTypes : null
    });

  } catch (error) {
    console.error('Info route error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch info' }, { status: 500 });
  }
}
