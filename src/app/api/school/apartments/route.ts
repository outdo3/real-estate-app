import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
import { fetchMolitData } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { XMLParser } from 'fast-xml-parser';

const normalizeAptName = (name: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

// 카카오 지번주소("...구 암남동 507-3")에서 동 이름과 지번을 분리한다.
// "산51"처럼 파싱 불가능한 형태(산번지 등)는 null을 반환해 건너뛴다.
const parseDongJibun = (addressName: string): { dong: string; jibun: string } | null => {
  const tokens = (addressName || '').trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const jibun = tokens[tokens.length - 1];
  const dong = tokens[tokens.length - 2];
  if (!/^\d+(-\d+)?$/.test(jibun)) return null;
  return { dong, jibun };
};

const BUILD_YEAR_API_KEY = process.env.DATA_GO_KR_API_KEY || '';

// 카카오 지번주소를 기반으로 건축물대장(표제부)에서 사용승인일(준공연도)을 조회한다.
// 실거래 유무와 무관하게 정확한 값을 얻을 수 있다 — src/app/api/apt/[name]/info/route.ts의
// 동일한 K-APT 조회 패턴을 이 라우트 용도(준공연도만 필요)에 맞춰 재구현한 것이다. 그 파일은
// 이미 배포·검증된 코드라 건드리지 않고 별도로 둔다.
async function fetchBuildYearFromRegistry(
  aptName: string,
  addressName: string,
  lawdCd: string,
  regcodes: any[]
): Promise<number | null> {
  if (!BUILD_YEAR_API_KEY || !lawdCd) return null;
  const parsed = parseDongJibun(addressName);
  if (!parsed) return null;

  try {
    const match = regcodes.find((r: any) => (r.name || '').includes(parsed.dong) && r.code.startsWith(lawdCd));
    if (!match) return null;
    const bjdongCd = match.code.substring(5, 10);

    const parts = parsed.jibun.split('-');
    const bunNum = parseInt(parts[0], 10);
    const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    if (isNaN(bunNum)) return null;
    const bun = bunNum.toString().padStart(4, '0');
    const ji = jiNum.toString().padStart(4, '0');

    const cleanKey = encodeURIComponent(decodeURIComponent(BUILD_YEAR_API_KEY.trim().replace(/['"]/g, '')));
    const bldUrl = `http://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo?serviceKey=${cleanKey}&sigunguCd=${lawdCd}&bjdongCd=${bjdongCd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=100`;

    const res = await fetch(bldUrl, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const xmlData = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
    const jsonObj = parser.parse(xmlData);
    const items = jsonObj.response?.body?.items?.item;
    if (!items) return null;
    const itemsArr = Array.isArray(items) ? items : [items];
    const aptCleanName = normalizeAptName(aptName);
    const target = itemsArr.find((it: any) => {
      const bldNm = (it.bldNm || '').replace(/\s+/g, '');
      return bldNm.includes(aptCleanName) || aptCleanName.includes(bldNm);
    }) || itemsArr[0];

    const useAprDay = target?.useAprDay ? String(target.useAprDay) : '';
    if (useAprDay.length >= 4) {
      const year = parseInt(useAprDay.substring(0, 4), 10);
      if (!isNaN(year) && year > 1900) return year;
    }
    return null;
  } catch (e) {
    return null;
  }
}

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

      // 법정동 코드 목록은 요청당 한 번만 조회해 모든 단지의 건축물대장 조회가 공유한다.
      let regcodes: any[] = [];
      if (BUILD_YEAR_API_KEY && lawdCd) {
        try {
          const regRes = await fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?is_ignore_zero=true`, { signal: AbortSignal.timeout(2500) });
          const regData = await regRes.json();
          regcodes = regData.regcodes || [];
        } catch (e) {
          console.warn('Failed to load regcodes for building registry lookup', e);
        }
      }

      // 실거래가: 공공데이터포털(MOLIT) 최근 24개월 매매 데이터에서 이름 매칭으로 조회
      // (12개월에서 확대 — 여전히 24개월 내 거래가 전혀 없는 단지는 정상적으로 "가격 정보
      // 없음"으로 남는다. 준공연도는 아래에서 건축물대장으로 별도 확보하므로 이 매칭에
      // 의존하지 않는다.)
      const realAptInfo = new Map<string, { priceStr: string; buildYear: number | null }>();
      if (lawdCd) {
        try {
          const now = new Date();
          const months = Array.from({ length: 24 }, (_, i) => {
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
          addressName: apt.address_name || '',
          price: matched?.priceStr || '가격 정보 없음',
          buildYear: matched?.buildYear ?? null,
          dist
        };
      });

      // 4. 반경 1.5km 이내 아파트 필터 및 거리순(오름차순) 정렬, 상위 20개만 사용
      const nearbyApartments = apartmentsWithDistance
        .filter(apt => apt.dist <= 1.5)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 20);

      // 4-1. 건축물대장에서 정확한 준공연도를 조회해 MOLIT 매칭값을 덮어쓴다(실거래 유무와
      // 무관하게 더 신뢰도 높은 값). 화면에 실제로 노출될 최대 20개에 대해서만 병렬 조회한다.
      const withRegistryBuildYear = await Promise.all(nearbyApartments.map(async apt => {
        const registryBuildYear = await fetchBuildYearFromRegistry(apt.name, apt.addressName, lawdCd, regcodes);
        return { ...apt, buildYear: registryBuildYear ?? apt.buildYear };
      }));

      // 5. 프론트엔드용 데이터 가공 (현실적인 도보 시간 계산 알고리즘)
      return withRegistryBuildYear.map(apt => {
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
