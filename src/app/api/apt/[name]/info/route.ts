import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchBuildingRegistryInfo, formatRatio, formatParking } from '@/lib/apt-building-info';

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

      if (response.ok) {
        const html = await response.text();
        const householdMatch = html.match(/(?:총\s*)?([0-9,]+)세대/);
        if (householdMatch) info['세대수'] = `${householdMatch[1]}세대`;

        const yearMatch = html.match(/([0-9]{4})년\s*(?:준공|입주)/);
        if (yearMatch) info['사용승인일'] = `${yearMatch[1]}년`;
      }
    } catch (e) {
      console.warn('Naver scraping failed', e);
    }

    // 2. 주차대수/용적률/건폐율: DB(apartments)에 이미 조회해둔 값이 있으면 그걸 바로 쓰고
    // (건축물대장 공공데이터 API를 매 페이지뷰마다 다시 부르지 않아도 됨), 없으면 라이브로
    // 조회한 뒤 다음 요청을 위해 DB에 저장해둔다(cache-aside) — scripts/backfill_apt_details.ts로
    // 미리 대량 채워둘 수도 있고, 실제 사용자가 페이지를 볼 때마다 조금씩 채워지기도 한다.
    // dong이 빈 문자열/undefined일 수 있는데, @@unique([name, dong])는 값이 항상 같은
    // 형태여야 매칭된다(null과 ''는 SQL에서 서로 다른 값으로 취급됨) — 이 라우트 안에서는
    // 항상 빈 문자열로 통일해 upsert의 where/create가 서로 어긋나지 않게 한다.
    const dongKey = dong || '';
    let registry: { parkingCount: number | null; far: number | null; bcr: number | null; totalHouseholds: number | null } | null = null;

    try {
      const cached = await prisma.apartment.findFirst({ where: { name: aptName, dong: dongKey } });
      if (cached && cached.parkingCount && cached.far && cached.bcr) {
        registry = {
          parkingCount: cached.parkingCount,
          far: cached.far,
          bcr: cached.bcr,
          totalHouseholds: cached.totalHouseholds ?? null,
        };
      }
    } catch (e) {
      console.warn('Apartment DB lookup failed (DB 미설정 등 — 라이브 조회로 폴백)', e);
    }

    if (!registry) {
      const live = await fetchBuildingRegistryInfo(aptName, lawdCd, dong, jibun);
      if (live) {
        registry = live;
        if (live.mainPurpose) info['주용도'] = live.mainPurpose;
        if (live.parkingCount || live.far || live.bcr || live.totalHouseholds) {
          try {
            await prisma.apartment.upsert({
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
              },
              update: {
                ...(jibun ? { jibun } : {}),
                ...(live.parkingCount ? { parkingCount: live.parkingCount } : {}),
                ...(live.far ? { far: live.far } : {}),
                ...(live.bcr ? { bcr: live.bcr } : {}),
                ...(live.totalHouseholds ? { totalHouseholds: live.totalHouseholds } : {}),
              },
            });
          } catch (e) {
            console.warn('Apartment DB upsert failed (DB 미설정 등 — 이번 응답에는 영향 없음)', e);
          }
        }
      }
    }

    // 네이버 스크래핑이 세대수를 못 찾았으면 건축물대장 총괄표제부의 세대수로 보완한다
    // (같은 API 호출에서 이미 받아온 값이라 추가 조회가 필요 없다).
    if (!info['세대수'] && registry?.totalHouseholds) {
      info['세대수'] = `${registry.totalHouseholds.toLocaleString('ko-KR')}세대`;
    }

    if (registry?.parkingCount) {
      const totalHouseholds = info['세대수'] ? parseInt(info['세대수'].replace(/,/g, ''), 10) : null;
      info['총주차대수'] = formatParking(registry.parkingCount, totalHouseholds);
    }
    if (registry?.far) info['용적률'] = formatRatio(registry.far);
    if (registry?.bcr) info['건폐율'] = formatRatio(registry.bcr);

    // 추정치 제공 금지 (정확한 데이터만 사용)
    // if (!info['총주차대수']) { ... }

    return NextResponse.json({
      success: true,
      aptName,
      info: Object.keys(info).length > 0 ? info : null
    });

  } catch (error) {
    console.error('Info route error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch info' }, { status: 500 });
  }
}
