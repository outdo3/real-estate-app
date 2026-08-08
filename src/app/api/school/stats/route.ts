import { NextResponse } from 'next/server';

const SIDO_CODES: Record<string, string> = {
  '서울특별시': 'B10', '부산광역시': 'C10', '대구광역시': 'D10', '인천광역시': 'E10', 
  '광주광역시': 'F10', '대전광역시': 'G10', '울산광역시': 'H10', '세종특별자치시': 'I10', 
  '경기도': 'J10', '강원특별자치도': 'K10', '충청북도': 'M10', '충청남도': 'N10', 
  '전북특별자치도': 'P10', '전라남도': 'Q10', '경상북도': 'R10', '경상남도': 'S10', '제주특별자치도': 'T10'
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || '부산광역시 서구';
  const [sido, gungu] = region.split(' ');
  
  const apiKey = process.env.NEIS_API_KEY || 'sample';
  const eduCode = SIDO_CODES[sido] || 'C10';

  try {
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

    // 지역 필터링 (엄격한 필터링: '서구' 검색 시 '강서구' 등 오매칭 방지)
    const regionSchools = rawSchools.filter(s => {
      const addr = (s.ORG_RDNMA || s.LCTN_SC_NM || '');
      // '부산광역시 서구' 등 region 텍스트가 정확히 포함되거나,
      // gungu가 포함되면서 오매칭 단어(강서구 등)가 포함되지 않은 경우만 허용
      if (addr.includes(region)) return true;
      if (addr.includes(gungu)) {
        // '서구' 검색인데 '강서구'가 주소에 있으면 제외
        if (gungu === '서구' && (addr.includes('강서구') || addr.includes('달서구') || addr.includes('서구청'))) return false;
        // '중구' 검색인데 '중랑구' 등이 있으면 제외 (필요시 추가)
        return true;
      }
      return false;
    });

    let elemCount = 0;
    let midCount = 0;
    let highCount = 0;
    
    let totalSpecRate = 0;
    let specRateCount = 0;

    regionSchools.forEach(s => {
      if (s.SCHUL_KND_SC_NM === '초등학교') elemCount++;
      else if (s.SCHUL_KND_SC_NM === '중학교') {
        midCount++;
        // 모의 진학률 산출 로직 (기존 route.ts와 동일 구조)
        const nameHash = s.SCHUL_NM.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
        const rate = (nameHash % 50) / 10 + (nameHash % 5);
        totalSpecRate += rate;
        specRateCount++;
      }
      else if (s.SCHUL_KND_SC_NM === '고등학교') highCount++;
    });

    const totalSchools = elemCount + midCount + highCount;
    let avgSpecRate = '0.0%';
    if (specRateCount > 0) {
      avgSpecRate = (totalSpecRate / specRateCount).toFixed(1) + '%';
    }

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
    const data = {
      totalSchools: finalTotalSchools,
      elemCount: elemCount,
      midCount: midCount,
      highCount: highCount,
      specRate: avgSpecRate,
      academyLocation: academyLocation,
      academyCount: academyCount
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to fetch stats' }, { status: 500 });
  }
}
