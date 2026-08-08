import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const schoolName = searchParams.get('schoolName') || '';
  const latParam = searchParams.get('lat');
  const lngParam = searchParams.get('lng');

  if (!schoolName) {
    return NextResponse.json({ success: false, error: 'School name is required' }, { status: 400 });
  }

  try {
    let schoolCoords = [129.0225, 35.0772]; // Default (송도)

    if (latParam && lngParam) {
      schoolCoords = [parseFloat(lngParam), parseFloat(latParam)];
    } else {
      // 카카오 로컬 API를 사용하여 학교 이름으로 실제 좌표 검색
      const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
      if (kakaoKey) {
        try {
          const kakaoUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(schoolName)}`;
          const kakaoRes = await fetch(kakaoUrl, {
            headers: { 
              'Authorization': `KakaoAK ${kakaoKey}`,
              'KA': 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
              'Origin': 'http://localhost:3000'
            }
          });
          if (kakaoRes.ok) {
            const kakaoData = await kakaoRes.json();
            if (kakaoData.documents && kakaoData.documents.length > 0) {
              const doc = kakaoData.documents[0];
              schoolCoords = [parseFloat(doc.x), parseFloat(doc.y)];
            }
          }
        } catch (err) {
          console.warn("Kakao API failed for school coords, using fallback", err);
        }
      }
      
      // 검색 실패시 기본 폴백 (기존 유지)
      if (!kakaoKey || schoolCoords[0] === 129.0225) {
        if (schoolName.includes('대신') || schoolName.includes('경남') || schoolName.includes('부경') || schoolName.includes('중앙') || schoolName.includes('구덕') || schoolName.includes('동신') || schoolName.includes('화랑')) {
          schoolCoords = [129.015, 35.115]; // 대신동 일대
        } else if (schoolName.includes('송도') || schoolName.includes('천마') || schoolName.includes('알로이시오')) {
          schoolCoords = [129.022, 35.075]; // 송도동 일대
        } else if (schoolName.includes('초장') || schoolName.includes('남부') || schoolName.includes('아미') || schoolName.includes('토성')) {
          schoolCoords = [129.010, 35.100]; // 충무동 일대
        }
      }
    }

    const schoolPoint = point(schoolCoords);

    // 2. 카카오 로컬 API로 반경 1.5km 내 아파트 검색 (키워드: 아파트)
    const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
    let searchedApartments: any[] = [];
    if (kakaoKey) {
      try {
        const radiusUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent('아파트')}&x=${schoolCoords[0]}&y=${schoolCoords[1]}&radius=1500`;
        const radiusRes = await fetch(radiusUrl, {
          headers: { 
            'Authorization': `KakaoAK ${kakaoKey}`,
            'KA': 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
            'Origin': 'http://localhost:3000'
          }
        });
        if (radiusRes.ok) {
          const radiusData = await radiusRes.json();
          searchedApartments = radiusData.documents || [];
        }
      } catch (err) {
        console.error("Failed to fetch apartments from Kakao", err);
      }
    }

    // 국토부 형식 mockData.json 불러오기 (실거래가 모의)
    const mockPrices: Record<string, string> = {};
    try {
      const fs = require('fs');
      const path = require('path');
      const mockFilePath = path.join(process.cwd(), 'src', 'lib', 'mockData.json');
      const mockFileContent = fs.readFileSync(mockFilePath, 'utf-8');
      const mockJson = JSON.parse(mockFileContent);
      const items = mockJson?.response?.body?.items?.item || [];
      items.forEach((it: any) => {
        mockPrices[it.아파트] = `${it.거래금액}만`; // 예: 59,000 -> 59,000만
      });
    } catch (e) {
      console.warn("Could not load mockData.json", e);
    }

    // 3. Turf.js를 사용하여 학교와 아파트 간의 직선거리(반경) 계산
    const apartmentsWithDistance = searchedApartments.map(apt => {
      const aptPoint = point([parseFloat(apt.x), parseFloat(apt.y)]);
      const dist = distance(schoolPoint, aptPoint, { units: 'kilometers' }); // 킬로미터 단위
      
      // 아파트 이름 정제 (예: '대신더샵 아파트' -> '대신더샵')
      const cleanName = apt.place_name.replace(/ 아파트$/, '').trim();
      
      return {
        id: apt.id,
        name: cleanName,
        price: mockPrices[cleanName] || '가격 정보 없음',
        dist
      };
    });

    // 4. 반경 1.5km 이내 아파트 필터 및 거리순(오름차순) 정렬
    const nearbyApartments = apartmentsWithDistance
      .filter(apt => apt.dist <= 1.5)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5); // 상위 5개

    // 5. 프론트엔드용 데이터 가공 (현실적인 도보 시간 계산 알고리즘)
    const result = nearbyApartments.map(apt => {
      // 직선거리(km)를 실제 도보 거리(구불구불한 길, 횡단보도 고려)로 변환
      const realDistance = apt.dist * 1.45; 
      
      // 성인 평균 도보 속도: 4km/h (1km당 15분)
      let walkMin = Math.round(realDistance * 15);
      
      // 횡단보도 대기 및 단지 내 이동 시간 등 기본 페널티 부여
      if (apt.dist > 0.1) {
          walkMin += 4; 
      }
      if (apt.dist > 0.5) {
          walkMin += 3;
      }

      // 특정 지형(송도) 언덕 페널티 보정
      if (schoolName.includes('송도')) {
          walkMin += 5;
      }

      walkMin = Math.max(3, walkMin); // 최소 3분 보장

      // 임의의 신축(준공연도) 부여: 이름의 길이나 해시를 이용해 현실감 있게 고정
      const nameHash = apt.name.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
      const buildYear = 1995 + (nameHash % 30); // 1995 ~ 2024 사이

      return {
        id: apt.id,
        name: apt.name,
        price: apt.price,
        walkTime: `도보 ${walkMin}분`,
        distance: apt.dist, // km 단위
        buildYear: buildYear
      };
    });

    if (result.length === 0) {
      result.push({
        id: -1, name: '인근 아파트 매물 없음', price: '-', walkTime: '-'
      });
    }

    return NextResponse.json({ success: true, data: result });

  } catch (error) {
    console.error('GIS Mapping Error:', error);
    return NextResponse.json({ success: false, error: 'GIS processing failed' }, { status: 500 });
  }
}
