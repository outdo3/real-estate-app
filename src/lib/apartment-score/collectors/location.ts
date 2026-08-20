// STEP SCORE S2B — 아파트 1건의 ApartmentLocationFeature raw feature를 실제로
// 수집한다. 점수/등급 계산 없음 — Kakao/TAGO 원본 응답에서 거리·개수만 뽑는다.
import { categorySearch, keywordSearch, keywordSearchNearestMatch, filterElementary, filterParks, filterBeaches, sleep } from './kakao';
import { collectNearestBusStop } from './tago';

export interface LocationFeatureTarget {
  aptSeq: string;
  latitude: number;
  longitude: number;
}

export interface LocationFeatureResult {
  aptSeq: string;
  latitude: number;
  longitude: number;
  nearestSubwayDistanceM: number | null;
  nearestSubwayName: string | null;
  subwayCount1000m: number | null;
  nearestBusStopDistanceM: number | null;
  busStopCount300m: number | null;
  martCount1000m: number | null;
  convenienceCount500m: number | null;
  pharmacyCount500m: number | null;
  hospitalCount1000m: number | null;
  parkCount1000m: number | null;
  daycareKindergartenCount500m: number | null;
  nearestElementaryDistanceM: number | null;
  elementaryCount1000m: number | null;
  beachDistanceM: number | null;
  qualityFlag: 'complete' | 'partial';
  failures: { feature: string; errorCategory: string; errorDetail?: string }[];
}

// KakaoAK 호출 사이 최소 간격 — data.go.kr/Kakao 정확한 일일/QPS 한도는
// EXTERNAL_VERIFICATION_REQUIRED(S1.1과 동일 표기 원칙, 실측 문서 없음)라 보수적으로
// 페이싱한다. 429는 kakao.ts에서 1회 재시도 후에도 실패하면 해당 feature만 결측 처리.
const KAKAO_CALL_DELAY_MS = 150;

export async function collectLocationFeature(target: LocationFeatureTarget): Promise<LocationFeatureResult> {
  const { aptSeq, latitude, longitude } = target;
  const failures: { feature: string; errorCategory: string; errorDetail?: string }[] = [];

  const record = <T,>(feature: string, ok: boolean, errorCategory?: string, errorDetail?: string) => {
    if (!ok) failures.push({ feature, errorCategory: errorCategory ?? 'unknown', errorDetail });
  };

  // 지하철(SW8, 1000m)
  const subway = await categorySearch('SW8', latitude, longitude, 1000);
  record('subway', subway.ok, subway.errorCategory, subway.errorDetail);
  await sleep(KAKAO_CALL_DELAY_MS);

  // 대형마트(MT1, 1000m)
  const mart = await categorySearch('MT1', latitude, longitude, 1000);
  record('mart', mart.ok, mart.errorCategory, mart.errorDetail);
  await sleep(KAKAO_CALL_DELAY_MS);

  // 편의점(CS2, 500m)
  const convenience = await categorySearch('CS2', latitude, longitude, 500);
  record('convenience', convenience.ok, convenience.errorCategory, convenience.errorDetail);
  await sleep(KAKAO_CALL_DELAY_MS);

  // 약국(PM9, 500m)
  const pharmacy = await categorySearch('PM9', latitude, longitude, 500);
  record('pharmacy', pharmacy.ok, pharmacy.errorCategory, pharmacy.errorDetail);
  await sleep(KAKAO_CALL_DELAY_MS);

  // 병원(HP8, 1000m)
  const hospital = await categorySearch('HP8', latitude, longitude, 1000);
  record('hospital', hospital.ok, hospital.errorCategory, hospital.errorDetail);
  await sleep(KAKAO_CALL_DELAY_MS);

  // 어린이집·유치원(PS3, 500m) — Kakao 공식 분류가 둘을 묶어서 반환(KakaoPlaces.tsx 기존 확인)
  const daycare = await categorySearch('PS3', latitude, longitude, 500);
  record('daycare', daycare.ok, daycare.errorCategory, daycare.errorDetail);
  await sleep(KAKAO_CALL_DELAY_MS);

  // 학교(SC4, 1000m) → 초등학교만 이름으로 필터(ai-search.ts findNearestElementarySchool과 동일 방식)
  const school = await categorySearch('SC4', latitude, longitude, 1000);
  record('elementary', school.ok, school.errorCategory, school.errorDetail);
  await sleep(KAKAO_CALL_DELAY_MS);

  // 공원(키워드 "공원", 1000m)
  const park = await keywordSearch('공원', latitude, longitude, 1000);
  record('park', park.ok, park.errorCategory, park.errorDetail);
  await sleep(KAKAO_CALL_DELAY_MS);

  // 해변(키워드 "해수욕장", 20000m — S1.1 §11 실측 방식, Kakao 반경 상한). canary
  // 실행에서 실측 확인된 문제(상호명 오염이 실제 해변을 15건 밖으로 밀어냄) 때문에
  // 공식 category_name 일치가 나올 때까지 최대 3페이지(Kakao 상한)까지 조회한다.
  const beach = await keywordSearchNearestMatch(
    '해수욕장',
    latitude,
    longitude,
    20000,
    (d) => filterBeaches([d]).length > 0
  );
  record('beach', beach.ok, beach.errorCategory, beach.errorDetail);
  await sleep(KAKAO_CALL_DELAY_MS);

  // 버스(TAGO, 좌표기반 근접정류소)
  const bus = await collectNearestBusStop(latitude, longitude);
  record('bus', bus.ok, bus.errorCategory, bus.errorDetail);

  const elementaryDocs = school.ok ? filterElementary(school.documents) : [];
  const parkDocs = park.ok ? filterParks(park.documents) : [];

  return {
    aptSeq,
    latitude,
    longitude,
    nearestSubwayDistanceM: subway.ok && subway.documents[0] ? Math.round(Number(subway.documents[0].distance)) : null,
    nearestSubwayName: subway.ok && subway.documents[0] ? subway.documents[0].place_name : null,
    subwayCount1000m: subway.ok ? subway.pageableCount : null,
    nearestBusStopDistanceM: bus.nearestBusStopDistanceM,
    busStopCount300m: bus.busStopCount300m,
    martCount1000m: mart.ok ? mart.pageableCount : null,
    convenienceCount500m: convenience.ok ? convenience.pageableCount : null,
    pharmacyCount500m: pharmacy.ok ? pharmacy.pageableCount : null,
    hospitalCount1000m: hospital.ok ? hospital.pageableCount : null,
    parkCount1000m: park.ok ? parkDocs.length : null,
    daycareKindergartenCount500m: daycare.ok ? daycare.pageableCount : null,
    nearestElementaryDistanceM: elementaryDocs[0] ? Math.round(Number(elementaryDocs[0].distance)) : null,
    elementaryCount1000m: school.ok ? elementaryDocs.length : null,
    beachDistanceM: beach.match ? Math.round(Number(beach.match.distance)) : null,
    qualityFlag: failures.length === 0 ? 'complete' : 'partial',
    failures,
  };
}
