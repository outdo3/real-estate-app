import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { aptNamesMatch, normalizeAptName } from '@/lib/apt-name-match';
import { getApartmentEducationZone } from '@/lib/education/attendance-zone';
import { findNearbyKindergartens, matchCanonicalHighSchool } from '@/lib/education/nearby-education';
import { logServerError } from '@/lib/log-server-error';

export const dynamic = 'force-dynamic';

// SCHOOL V2-D1 §22 — 기존 /api/apt/[name]/{info,score,facilities}와 나란한 별도
// route로 신설했다(기존 라우트 확장 대신). 이유: getApartmentEducationZone()이
// School V2-C6-B artifact(5.76MB, fs 읽기)를 매번 읽는 무거운 호출이라 기존 route의
// 응답 흐름/캐시 정책에 얹으면 그 route 전체가 함께 느려지거나(§27 성능 회귀 금지)
// 서로 무관한 관심사가 섞인다. aptSeq 해석 로직은 /score route와 동일 원칙(정확한
// 이름 일치 우선 → 느슨한 매칭 폴백, 여러 건이면 AMBIGUOUS로 안전하게 실패)을
// 그대로 재사용했다 — 다만 API 호출 자체를 공유할 방법은 없어(서로 다른 데이터가
// 필요) 로직만 재사용하고 실제 fetch는 새로 한다(§20 "불필요한 API 중복호출 금지"는
// "같은 데이터를 두 번 부르지 않는다"는 뜻으로 해석, 이 route 자체가 1회만 호출됨).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const aptName = decodeURIComponent(name);
    const { searchParams } = new URL(request.url);

    let lawdCd = searchParams.get('lawdCd') || '';
    let dong = searchParams.get('dong') || '';

    if (!lawdCd || !dong) {
      try {
        // BUSAN_DATA_UX_AUTOMATED_QA_V1 §L4/식별자 감사: lawdCd 없이 { name: aptName }만
        // 조회하면 타 지역 동명 단지를 집어올 수 있다(실측: 대신롯데캐슬 서울/부산 충돌,
        // route.ts/score/route.ts와 동일 근거). lawdCd가 이미 있을 때만 조회한다.
        const cached = lawdCd
          ? await prisma.apartment.findFirst({
              where: { name: aptName, lawdCd },
              select: { lawdCd: true, dong: true },
            })
          : null;
        if (!lawdCd && cached?.lawdCd) lawdCd = cached.lawdCd;
        if (!dong && cached?.dong) dong = cached.dong;
      } catch {
        // DB 미설정 등 — 아래에서 lawdCd 없음으로 자연스럽게 AMBIGUOUS 처리됨
      }
    }

    if (!lawdCd) {
      return NextResponse.json(emptyResponse('AMBIGUOUS'));
    }

    const candidates = await prisma.apartmentMaster.findMany({
      where: { sggCd: lawdCd, aptSeq: { not: null }, ...(dong ? { umdName: dong } : {}) },
      select: { aptSeq: true, name: true, latitude: true, longitude: true },
    });
    const exactMatches = candidates.filter((c) => normalizeAptName(c.name) === normalizeAptName(aptName));
    const matched = exactMatches.length > 0 ? exactMatches : candidates.filter((c) => aptNamesMatch(c.name, aptName));

    if (matched.length === 0) return NextResponse.json(emptyResponse('NOT_FOUND'));
    if (matched.length > 1) return NextResponse.json(emptyResponse('AMBIGUOUS'));

    const apt = matched[0];
    const zone = apt.aptSeq ? getApartmentEducationZone(apt.aptSeq) : null;

    let kindergartens: Awaited<ReturnType<typeof findNearbyKindergartens>> = [];
    let nearbyElementarySchools: NearbyKakaoSchool[] = [];
    let nearbyHighSchools: NearbyKakaoSchool[] = [];

    if (apt.latitude != null && apt.longitude != null) {
      kindergartens = await findNearbyKindergartens(apt.latitude, apt.longitude, 5).catch(() => []);
      [nearbyElementarySchools, nearbyHighSchools] = await Promise.all([
        fetchNearbySchoolsByKeyword('초등학교', apt.latitude, apt.longitude),
        fetchNearbySchoolsByKeyword('고등학교', apt.latitude, apt.longitude),
      ]);
      // 안전 매칭(이름+lawdCd+HIGH 유일)이 성립할 때만 설립유형을 붙인다 — 실패 시 null 유지.
      nearbyHighSchools = await Promise.all(
        nearbyHighSchools.map(async (s) => {
          const canonical = await matchCanonicalHighSchool(s.name, lawdCd).catch(() => null);
          return canonical ? { ...s, establishmentType: canonical.establishmentType } : s;
        })
      );
    }

    return NextResponse.json({
      status: 'OK',
      aptSeq: apt.aptSeq,
      elementaryAttendanceZone: zone?.elementary ?? null,
      middleSchoolGroup: zone?.middle ?? null,
      nearbyElementarySchools,
      nearbyHighSchools,
      kindergartens,
      datasetVersion: zone?.datasetVersion ?? null,
    });
  } catch (error) {
    logServerError((error as Error)?.message || 'apt education route error', '/api/apt/[name]/education', (error as Error)?.stack).catch(() => {});
    return NextResponse.json(emptyResponse('INSUFFICIENT_DATA'));
  }
}

interface NearbyKakaoSchool {
  name: string;
  distanceM: number;
  establishmentType: string | null;
}

// 학교 canonical 좌표는 여전히 0%(C5-B 이후 변동 없음)라 "가장 가까운 초/고등학교"
// 목록은 Kakao 실시간 키워드검색(REST, school/apartments/route.ts와 동일한 서버측
// 호출 패턴 재사용)으로만 구할 수 있다 — 저장하지 않고 매 요청 read-only 조회.
async function fetchNearbySchoolsByKeyword(keyword: '초등학교' | '고등학교', lat: number, lng: number): Promise<NearbyKakaoSchool[]> {
  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!kakaoKey) return [];
  try {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=3000&sort=distance`;
    const res = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${kakaoKey}`,
        KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
        Origin: 'http://localhost:3000',
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const docs: any[] = Array.isArray(data.documents) ? data.documents : [];
    return docs
      .filter((d) => d.category_group_code === 'SC4' && d.place_name.endsWith(keyword))
      .slice(0, 3)
      .map((d) => ({ name: d.place_name, distanceM: Number(d.distance), establishmentType: null }));
  } catch {
    return [];
  }
}

function emptyResponse(status: 'NOT_FOUND' | 'AMBIGUOUS' | 'INSUFFICIENT_DATA') {
  return {
    status,
    aptSeq: null,
    elementaryAttendanceZone: null,
    middleSchoolGroup: null,
    nearbyElementarySchools: [],
    nearbyHighSchools: [],
    kindergartens: [],
    datasetVersion: null,
  };
}
