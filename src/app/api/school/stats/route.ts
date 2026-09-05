import { NextResponse } from 'next/server';
import { resolveNeisEduCode, addressMatchesRegion } from '@/lib/neis-sido-codes';
import { getOrSetCache } from '@/lib/server-cache';

// PERFORMANCE_V2.1 §5 — 이 라우트는 요청마다 외부 API를 약 7회 부른다:
// NEIS 학교목록을 **시도 전체**로 페이지네이션 전량 조회(부산 기준 3페이지) +
// Kakao 주소 지오코딩 1회 + 학원 카테고리 검색 최대 3회. 캐시가 전혀 없어
// 실측 warm 지연이 **1,105ms**로, 프로젝트 목표(500ms)를 유일하게 넘고 있었다.
//
// 담는 값은 거래/가격 데이터가 아니라 **학교 명부와 학원 개수**다. 학교 명부는 학년도
// 단위로, 학원 수는 그보다 느리게 바뀐다. 그래서 6시간 TTL이 진실성에 실질적 위험을
// 주지 않는다 — 실거래 신선도 계약(PERFORMANCE_V2 가드레일)은 이 라우트와 무관하다.
// 되돌리려면 이 상수만 바꾸면 된다.
const SCHOOL_STATS_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || '부산광역시 서구';
  const [sido, gungu] = region.split(' ');

  const apiKey = process.env.NEIS_API_KEY || 'sample';
  const eduCode = resolveNeisEduCode(sido) || 'C10';

  try {
    const data = await getOrSetCache(`school-stats:${region}`, SCHOOL_STATS_TTL_MS, async () => {
    // 1. NEIS 학교 데이터 페칭 (pSize와 무관하게 최대 500건까지만 반환되므로 페이지 순회로 전량 확보)
    let rawSchools: any[] = [];

    try {
      const pageSize = 500;
      let pIndex = 1;
      let totalCount = Infinity;

      while ((pIndex - 1) * pageSize < totalCount) {
        const neisUrl = `https://open.neis.go.kr/hub/schoolInfo?KEY=${apiKey}&Type=json&pIndex=${pIndex}&pSize=${pageSize}&ATPT_OFCDC_SC_CODE=${eduCode}`;
        const res = await fetch(neisUrl);
        if (!res.ok) break;
        const data = await res.json();
        totalCount = data.schoolInfo?.[0]?.head?.[0]?.list_total_count ?? 0;
        const rows = data.schoolInfo?.[1]?.row || [];
        if (rows.length === 0) break;
        rawSchools = rawSchools.concat(rows);
        pIndex++;
      }
    } catch (e) {
      console.warn("NEIS API failed in stats, using empty");
    }

    // 지역 필터링: 주소를 토큰 단위로 쪼개 gungu와 정확히 일치하는 경우만 허용
    // (예전 addr.includes(gungu) 방식은 "강서구".includes("서구") === true라
    // '서구'를 선택해도 '강서구' 학교가 함께 매칭될 수 있었다)
    const regionSchools = rawSchools.filter(s => {
      const addr = (s.ORG_RDNMA || s.LCTN_SC_NM || '');
      return addressMatchesRegion(addr, region, gungu);
    });

    let elemCount = 0;
    let midCount = 0;
    let highCount = 0;

    regionSchools.forEach(s => {
      if (s.SCHUL_KND_SC_NM === '초등학교') elemCount++;
      else if (s.SCHUL_KND_SC_NM === '중학교') midCount++;
      else if (s.SCHUL_KND_SC_NM === '고등학교') highCount++;
    });

    const totalSchools = elemCount + midCount + highCount;
    // 특목고 진학률: NEIS schoolInfo API에는 이 값이 없고, 이 앱에 다른 실제 데이터
    // 소스도 없다. 과거에는 학교명 문자열 해시로 만든 가짜 수치를 여기 채워 넣었으나
    // (STEP 1 감사에서 발견), 실제 근거가 없는 값을 통계처럼 보여주지 않는다는 원칙에
    // 따라 항상 null을 반환한다 — 화면에서는 "데이터 준비 중"으로 표시한다.
    const specRate: string | null = null;

    // 2. 카카오 로컬 API로 학원(AC5) 실집계
    // - 키워드 텍스트 검색의 meta.total_count는 지역과 무관하게 부풀려진 추정치라 신뢰할 수 없으므로
    //   구 중심좌표 기준 반경 카테고리 검색으로 바꾸고, 실제로 페이지네이션으로 회수 가능한 건수(최대 45건,
    //   카카오 API 자체 한도)만 집계한다.
    const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
    let academyCount = 0;
    let academyLocation = gungu; // 기본값

    try {
      const kakaoHeaders = {
        'Authorization': `KakaoAK ${kakaoKey}`,
        'KA': 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
        'Origin': 'http://localhost:3000'
      };

      const addrRes = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(region)}`, { headers: kakaoHeaders });
      const addrData = addrRes.ok ? await addrRes.json() : null;
      const center = addrData?.documents?.[0];

      if (center) {
        const centerX = center.x;
        const centerY = center.y;
        const dongCounts: Record<string, number> = {};
        const seenIds = new Set<string>();

        for (let page = 1; page <= 3; page++) {
          const catUrl = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=AC5&x=${centerX}&y=${centerY}&radius=3000&page=${page}&size=15`;
          const catRes = await fetch(catUrl, { headers: kakaoHeaders });
          if (!catRes.ok) break;
          const catData = await catRes.json();
          const docs = catData.documents || [];
          docs.forEach((doc: any) => {
            if (seenIds.has(doc.id)) return;
            seenIds.add(doc.id);
            const parts = (doc.address_name || '').split(' ');
            const dong = parts[2] || gungu; // 예: "부산 서구 서대신동3가" -> "서대신동3가"
            dongCounts[dong] = (dongCounts[dong] || 0) + 1;
          });
          if (catData.meta?.is_end !== false) break; // 마지막 페이지면 중단
        }

        academyCount = seenIds.size;
        const topDong = Object.entries(dongCounts).sort((a, b) => b[1] - a[1])[0];
        if (topDong) academyLocation = topDong[0];
      } else {
        academyCount = -1; // 구 중심좌표를 못 찾은 경우 (통신 실패/권한 없음)
      }
    } catch (err) {
      console.warn("Kakao API failed for academy stats", err);
      academyCount = -1; // 더미 숫자 방지용 플래그
    }

    // 총 학교 수는 반드시 초+중+고 합계로 산출 (실패 시 임의 숫자로 채우지 않고 0 그대로 반환)
    const finalTotalSchools = elemCount + midCount + highCount;

      // 결과 조립
      return {
        totalSchools: finalTotalSchools,
        elemCount: elemCount,
        midCount: midCount,
        highCount: highCount,
        specRate: specRate,
        academyLocation: academyLocation,
        academyCount: academyCount
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to fetch stats' }, { status: 500 });
  }
}
