import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
import { fetchMolitData } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { XMLParser } from 'fast-xml-parser';
import { prisma } from '@/lib/prisma';

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

// SCHOOL V2-C5-B §6/§11: canonical 좌표 정책의 1순위 — School 테이블에 좌표가 있고
// (schoolName, sigunguCode=lawdCd) 조합이 유일하게 하나로 확정될 때만 사용한다.
// 이름이 같은 학교가 같은 구·군에 둘 이상 있으면(실측 확인된 사례: 강서구 송정초등학교/
// 대저중앙초등학교/가락중학교, docs/development/SCHOOL-V2-C5B-coordinate-provenance.md
// §4 참고) null을 반환해 절대 추측하지 않는다 — "학교명 단독 매칭 금지" 원칙 그대로.
// 현재 School.latitude/longitude는 아직 채워지지 않은 상태라(§7, SchoolInfo 소스가
// EducationSource에 CLEARED로 등록되기 전까지 write 보류) 이 함수는 지금은 항상 null을
// 반환하지만, 좌표가 채워지면 별도 코드 변경 없이 즉시 동작하도록 미리 만들어 둔다.
async function lookupCanonicalSchoolCoordinate(schoolName: string, lawdCd: string): Promise<[number, number] | null> {
  if (!schoolName || !lawdCd) return null;
  try {
    const matches = await prisma.school.findMany({
      where: { schoolName, sigunguCode: lawdCd, latitude: { not: null }, longitude: { not: null } },
      select: { latitude: true, longitude: true },
    });
    if (matches.length !== 1) return null; // 0건이거나 모호(2건 이상)하면 사용하지 않는다
    const { latitude, longitude } = matches[0];
    if (latitude == null || longitude == null) return null;
    return [longitude, latitude];
  } catch (e) {
    console.warn('Canonical School coordinate lookup failed', schoolName, lawdCd, e);
    return null;
  }
}

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
    const candidates = regcodes.filter((r: any) => typeof r.code === 'string' && r.code.startsWith(lawdCd));
    const match = candidates.find((r: any) => String(r.name || '').split(/\s+/).pop() === parsed.dong)
      || candidates.find((r: any) => String(r.name || '').includes(parsed.dong));
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
    console.warn('Building registry lookup failed', aptName, e);
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
      const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;

      // 1~2. 학교 좌표 확인 → 반경 1.5km 내 아파트 검색(카카오). 좌표를 먼저 알아야
      // 반경 검색을 할 수 있어 이 둘은 순차적일 수밖에 없다.
      //
      // SCHOOL V2-C5-B §10/§11: 예전에는 학교 좌표를 못 찾으면 부산 서구 송도동
      // 대표좌표([129.0225, 35.0772])로 조용히 대체하고, 학교명에 특정 문자열이
      // 있으면 대신동/송도동/충무동 중 하나로 "그럴듯하게" 보정했다 — 다른 지역
      // 학교인데 서구 좌표로 계산되는 사고가 구조적으로 가능했다(C5 audit §2).
      // 이번 STEP에서 완전히 제거했고, 다른 부산 좌표로도 대체하지 않는다 — 학교
      // 좌표를 확정하지 못하면 schoolCoords를 null로 두고 이 학교의 "인근 아파트"
      // 자체를 비워서(기존에도 있던 "인근 아파트 매물 없음" 안전 경로로 자연히
      // 합류) 정직하게 처리한다.
      const resolveSchoolAndApartments = async (): Promise<{ schoolCoords: [number, number] | null; searchedApartments: any[] }> => {
        let schoolCoords: [number, number] | null = null;

        if (latParam && lngParam) {
          schoolCoords = [parseFloat(lngParam), parseFloat(latParam)];
        } else {
          // 1순위: canonical School 테이블 좌표(현재는 항상 미확보 상태 — §7 참고)
          schoolCoords = await lookupCanonicalSchoolCoordinate(schoolName, lawdCd);

          // 2순위: 카카오 로컬 API로 학교 이름 실시간 검색(기존 유지 — 실제 이 학교를
          // 찾으려는 시도이지 다른 위치로의 폴백이 아니다)
          if (!schoolCoords && kakaoKey) {
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
              console.warn("Kakao API failed for school coords", err);
            }
          }
          // 여기서도 못 찾으면 schoolCoords는 null로 남는다 — 하드코딩된 다른 좌표로
          // 대체하지 않는다(더 이상의 fallback 없음).
        }

        let searchedApartments: any[] = [];
        if (schoolCoords && kakaoKey) {
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

        return { schoolCoords, searchedApartments };
      };

      // 법정동 코드 목록 조회 — lawdCd만 있으면 되고 학교 좌표/카카오 검색과 무관하다.
      const fetchRegcodes = async (): Promise<any[]> => {
        if (!BUILD_YEAR_API_KEY || !lawdCd) return [];
        try {
          const regRes = await fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?is_ignore_zero=true`, { signal: AbortSignal.timeout(2500) });
          const regData = await regRes.json();
          return regData.regcodes || [];
        } catch (e) {
          console.warn('Failed to load regcodes for building registry lookup', e);
          return [];
        }
      };

      // 실거래가: 공공데이터포털(MOLIT) 최근 24개월 매매 데이터에서 이름 매칭으로 조회 —
      // 이 역시 lawdCd만 있으면 되고 학교 좌표/카카오 검색과 무관하다.
      // (12개월에서 확대 — 여전히 24개월 내 거래가 전혀 없는 단지는 정상적으로 "가격 정보
      // 없음"으로 남는다. 준공연도는 아래에서 건축물대장으로 별도 확보하므로 이 매칭에
      // 의존하지 않는다.)
      const fetchRealAptInfo = async (): Promise<Map<string, { priceStr: string; buildYear: number | null }>> => {
        const map = new Map<string, { priceStr: string; buildYear: number | null }>();
        if (!lawdCd) return map;
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
              if (!key || map.has(key)) continue;
              map.set(key, {
                priceStr: t.price,
                buildYear: t.buildYear ? parseInt(t.buildYear, 10) : null,
              });
            }
          }
        } catch (e) {
          console.warn('Failed to load real MOLIT data for nearby apartments', e);
        }
        return map;
      };

      // 위 세 갈래(학교 좌표+반경 검색 / 법정동 코드 / MOLIT 24개월 실거래)는 서로 데이터
      // 의존성이 없다 — 이전에는 순서대로 기다렸지만(합치면 지연 시간이 그대로 합산됨),
      // Promise.all로 동시에 실행해 전체 응답 시간을 세 갈래 중 가장 느린 것 수준으로 줄인다.
      const [{ schoolCoords, searchedApartments }, regcodes, realAptInfo] = await Promise.all([
        resolveSchoolAndApartments(),
        fetchRegcodes(),
        fetchRealAptInfo(),
      ]);

      // schoolCoords가 null이면(§10/§11 — 더 이상 다른 좌표로 대체하지 않음)
      // searchedApartments도 이미 빈 배열이라(resolveSchoolAndApartments 참고)
      // 아래 map은 그대로 빈 배열을 반환한다 — Turf point()만 null 가드로 보호한다.
      const schoolPoint = schoolCoords ? point(schoolCoords) : null;

      // 3. Turf.js를 사용하여 학교와 아파트 간의 직선거리(반경) 계산
      const apartmentsWithDistance = !schoolPoint ? [] : searchedApartments.map(apt => {
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

      // 5. 프론트엔드용 데이터 가공 (SCHOOL V2-C5-A: 실제 보행경로 API가 없는 상태에서
      // "도보 N분"을 만들어 보여주면 확보하지 못한 정확도를 확보한 것처럼 오해하게
      // 만든다 — Turf 직선거리에 임의 보정계수(1.45배 + 분당 15분 환산 + 거리별 flat
      // 보정)를 적용해 "도보 약 N분"으로 표시하던 이전 로직을 제거하고, 실제로 갖고
      // 있는 값(직선거리)만 그 사실 그대로("직선거리 약 Nm") 노출한다. 도보/차량
      // 소요시간이 필요하면 SCHOOL V2-C5-C(정식 보행경로 provider 연동) 이후에나
      // 정직하게 추가할 수 있다.
      //
      // [BUSAN SCORE DATA V1 §1] 참고로 과거엔 schoolName.includes('송도')면
      // walkMin+5를 더하는 "특정 지형(송도) 언덕 페널티 보정"이 있었으나 실측 근거
      // 없는 임의 추정치라 이미 제거됐다(§1) — 이번 STEP은 그 walkMin 산출 로직
      // 자체를 없애는 것이라 이 이력은 더 이상 해당하지 않는다.
      //
      // `walkTime` 필드명은 하위 호환을 위해 유지하되(응답 shape 유지, breaking
      // change 최소화) 값은 더 이상 "도보 N분"이 아니라 `distanceLabel`과 동일한
      // 직선거리 문구를 담는다 — @deprecated, 신규 소비자는 `distanceMeters`/
      // `distanceLabel`을 쓰고 이 필드는 다른 소비자가 없음이 확인되면 제거한다
      // (docs/development/SCHOOL-V2-C5A-distance-label-correction.md 참고).
      return withRegistryBuildYear.map(apt => {
        const distanceMeters = Math.round(apt.dist * 1000);
        const distanceLabel = `직선거리 약 ${distanceMeters}m`;

        return {
          id: apt.id,
          name: apt.name,
          price: apt.price,
          distanceMeters,
          distanceLabel,
          /** @deprecated use distanceLabel/distanceMeters instead — no longer "도보 N분" */
          walkTime: distanceLabel,
          distance: apt.dist,
          buildYear: apt.buildYear
        };
      });
    });

    const finalResult = result.length === 0
      ? [{ id: -1, name: '인근 아파트 매물 없음', price: '-', distanceMeters: null, distanceLabel: '-', walkTime: '-', distance: 0, buildYear: null }]
      : result;

    return NextResponse.json({ success: true, data: finalResult });

  } catch (error) {
    console.error('GIS Mapping Error:', error);
    return NextResponse.json({ success: false, error: 'GIS processing failed' }, { status: 500 });
  }
}
