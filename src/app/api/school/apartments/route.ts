import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
import { fetchMolitData } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';

const normalizeAptName = (name: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const schoolName = searchParams.get('schoolName') || '';
  const latParam = searchParams.get('lat');
  const lngParam = searchParams.get('lng');
  const lawdCd = searchParams.get('lawdCd') || '';

  if (!schoolName) {
    return NextResponse.json({ success: false, error: 'School name is required' }, { status: 400 });
  }

  try {
    const cacheKey = `school-apts:${schoolName}:${lawdCd}:${latParam || ''}:${lngParam || ''}`;

    const result = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
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

      // 실거래가/준공연도: 공공데이터포털(MOLIT) 최근 12개월 매매 데이터에서 이름 매칭으로 조회
      const realAptInfo = new Map<string, { priceStr: string; buildYear: number | null }>();
      if (lawdCd) {
        try {
          const now = new Date();
          const months = Array.from({ length: 12 }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
          });
          const monthlyResults = await Promise.all(
            months.map(dealYmd => fetchMolitData({ type: 'apt', lawdCd, dealYmd }).catch(() => []))
          );
          for (const trades of monthlyResults) {
            for (const t of trades as any[]) {
              const key = normalizeAptName(t.name);
              if (!key || realAptInfo.has(key)) continue;
              realAptInfo.set(key, {
                priceStr: t.price,
                buildYear: t.buildYear ? parseInt(t.buildYear, 10) : null,
              });
            }
          }
        } catch (e) {
          console.warn('Failed to load real MOLIT data for nearby apartments', e);
        }
      }

      // 3. Turf.js를 사용하여 학교와 아파트 간의 직선거리(반경) 계산
      const apartmentsWithDistance = searchedApartments.map(apt => {
        const aptPoint = point([parseFloat(apt.x), parseFloat(apt.y)]);
        const dist = distance(schoolPoint, aptPoint, { units: 'kilometers' });

        const cleanName = apt.place_name.replace(/ 아파트$/, '').trim();
        const matched = realAptInfo.get(normalizeAptName(cleanName));

        return {
          id: apt.id,
          name: cleanName,
          price: matched?.priceStr || '가격 정보 없음',
          buildYear: matched?.buildYear ?? null,
          dist
        };
      });

      // 4. 반경 1.5km 이내 아파트 필터 및 거리순(오름차순) 정렬
      const nearbyApartments = apartmentsWithDistance
        .filter(apt => apt.dist <= 1.5)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5);

      // 5. 프론트엔드용 데이터 가공 (현실적인 도보 시간 계산 알고리즘)
      return nearbyApartments.map(apt => {
        const realDistance = apt.dist * 1.45;

        let walkMin = Math.round(realDistance * 15);

        if (apt.dist > 0.1) {
          walkMin += 4;
        }
        if (apt.dist > 0.5) {
          walkMin += 3;
        }

        if (schoolName.includes('송도')) {
          walkMin += 5;
        }

        walkMin = Math.max(3, walkMin);

        return {
          id: apt.id,
          name: apt.name,
          price: apt.price,
          walkTime: `도보 ${walkMin}분`,
          distance: apt.dist,
          buildYear: apt.buildYear
        };
      });
    });

    const finalResult = result.length === 0
      ? [{ id: -1, name: '인근 아파트 매물 없음', price: '-', walkTime: '-', distance: 0, buildYear: null }]
      : result;

    return NextResponse.json({ success: true, data: finalResult });

  } catch (error) {
    console.error('GIS Mapping Error:', error);
    return NextResponse.json({ success: false, error: 'GIS processing failed' }, { status: 500 });
  }
}
