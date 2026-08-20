// STEP SCORE S2B — 서버 전용 Kakao Local REST 수집기.
//
// src/components/KakaoPlaces.tsx는 브라우저 JS SDK(window.kakao) 기반이라 배치
// 스크립트에서 재사용할 수 없다(S1.1/S2A에서 이미 확인된 사실). 대신 이 프로젝트가
// 서버 코드에서 이미 검증한 REST 직접 호출 패턴(src/lib/ai-search.ts
// findNearestElementarySchool, src/app/api/transactions/route.ts geocodeApt)을
// 그대로 재사용한다 — 이 JS 키(NEXT_PUBLIC_KAKAO_MAP_API_KEY)는 REST 호출 시
// KA/Origin 헤더 없이 보내면 401을 반환한다는 것이 실측으로 이미 확인돼 있다.
//
// 새 API 키/새 외부 의존성이 아니다 — 이 프로젝트 전체가 서버 코드에서도 이미
// 이 client 변수를 재사용하는 기존 관례를 그대로 따른다(신규 서버 전용 키 없음).

const KAKAO_CATEGORY_URL = 'https://dapi.kakao.com/v2/local/search/category.json';
const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';

// 장소명에 이 문자열이 포함되면 결과에서 제외한다 — KakaoPlaces.tsx의 기존 필터와
// 동일(아파트/빌라 단지명, 화장실 등 실제 인프라가 아닌 결과 배제).
const EXCLUDED_NAME_SUBSTRINGS = ['아파트', '빌라', '화장실', '맨션', '타워'];

export interface KakaoDocument {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code?: string;
  distance: string; // Kakao가 x/y+sort=distance일 때 채워주는 실제 직선거리(m), 문자열
  x: string;
  y: string;
}

export interface KakaoSearchResult {
  documents: KakaoDocument[];
  pageableCount: number; // Kakao meta.pageable_count — 최대 45(3페이지)로 상한
  ok: boolean;
  errorCategory?: 'no_key' | 'rate_limited' | 'http_error' | 'network_error';
  errorDetail?: string;
}

function kakaoHeaders(): Record<string, string> {
  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!kakaoKey) throw new Error('NO_KAKAO_KEY');
  return {
    Authorization: `KakaoAK ${kakaoKey}`,
    // src/lib/ai-search.ts findNearestElementarySchool에서 실측 검증된 우회법 재사용.
    KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
    Origin: 'http://localhost:3000',
  };
}

async function fetchKakaoOnce(url: string): Promise<KakaoSearchResult> {
  let headers: Record<string, string>;
  try {
    headers = kakaoHeaders();
  } catch {
    return { documents: [], pageableCount: 0, ok: false, errorCategory: 'no_key' };
  }

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  } catch (e: any) {
    return { documents: [], pageableCount: 0, ok: false, errorCategory: 'network_error', errorDetail: e?.message };
  }

  if (res.status === 429) {
    return { documents: [], pageableCount: 0, ok: false, errorCategory: 'rate_limited' };
  }
  if (!res.ok) {
    return { documents: [], pageableCount: 0, ok: false, errorCategory: 'http_error', errorDetail: `HTTP ${res.status}` };
  }

  const json = await res.json();
  return {
    documents: json.documents ?? [],
    pageableCount: json.meta?.pageable_count ?? (json.documents?.length ?? 0),
    ok: true,
  };
}

// 429 발생 시 1회만 짧게 backoff 후 재시도한다 — TAGO 재시도 정책(bus-stops/route.ts)과
// 같은 "무한 대기 아님, 고정 1회 고정 지연" 원칙.
async function fetchKakaoWithRetry(url: string): Promise<KakaoSearchResult> {
  const first = await fetchKakaoOnce(url);
  if (first.ok || first.errorCategory !== 'rate_limited') return first;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return fetchKakaoOnce(url);
}

export async function categorySearch(
  categoryGroupCode: string,
  lat: number,
  lng: number,
  radiusM: number
): Promise<KakaoSearchResult> {
  const url = `${KAKAO_CATEGORY_URL}?category_group_code=${categoryGroupCode}&x=${lng}&y=${lat}&radius=${radiusM}&sort=distance&size=15`;
  return fetchKakaoWithRetry(url);
}

export async function keywordSearch(
  query: string,
  lat: number,
  lng: number,
  radiusM: number,
  page = 1
): Promise<KakaoSearchResult> {
  const url = `${KAKAO_KEYWORD_URL}?query=${encodeURIComponent(query)}&x=${lng}&y=${lat}&radius=${radiusM}&sort=distance&size=15&page=${page}`;
  return fetchKakaoWithRetry(url);
}

// "해수욕장" 키워드 검색이 실제 canary 실행에서 실측 확인한 문제: 안경점/PC방/환전소/
// 화장실/주차장처럼 상호명에 "OO해수욕장"이 붙은 업체가 정렬 상위(거리순 1~15위)를
// 전부 채워, 진짜 해변(category_name "해수욕장,해변")이 15건 안에 아예 들지 못하는
// 사례를 실제로 발견했다(예: 해운대구 반여동 — pageable_count 45 중 상위 15건 전부
// 관련 업체, 진짜 해수욕장은 16위 이후). sort=distance라 페이지 간 순서가 유지되므로,
// 실제 category_name 일치가 나오는 페이지에서 즉시 멈추면(조기 종료) 그게 최단거리
// 매치다 — Kakao 페이지 상한(45, 3페이지)까지만 확인한다.
export async function keywordSearchNearestMatch(
  query: string,
  lat: number,
  lng: number,
  radiusM: number,
  matcher: (doc: KakaoDocument) => boolean,
  maxPages = 3
): Promise<{ match: KakaoDocument | null; pagesFetched: number; ok: boolean; errorCategory?: string; errorDetail?: string }> {
  for (let page = 1; page <= maxPages; page++) {
    const result = await keywordSearch(query, lat, lng, radiusM, page);
    if (!result.ok) {
      return { match: null, pagesFetched: page, ok: false, errorCategory: result.errorCategory, errorDetail: result.errorDetail };
    }
    const match = result.documents.find(matcher);
    if (match) return { match, pagesFetched: page, ok: true };
    if (result.documents.length < 15) break; // 마지막 페이지(더 이상 결과 없음)
    await sleep(120);
  }
  return { match: null, pagesFetched: maxPages, ok: true };
}

export function filterExcludedNames(docs: KakaoDocument[]): KakaoDocument[] {
  return docs.filter((d) => !EXCLUDED_NAME_SUBSTRINGS.some((s) => d.place_name.includes(s)));
}

// S1.1 §11에서 실측 확인된 Kakao 공식 category_name 경로("관광,명소 > 해수욕장,해변") —
// 이름 추정이 아니라 Kakao가 매기는 공식 분류로 필터링한다.
export function filterBeaches(docs: KakaoDocument[]): KakaoDocument[] {
  return docs.filter((d) => d.category_name.includes('해수욕장,해변'));
}

export function filterElementary(docs: KakaoDocument[]): KakaoDocument[] {
  return docs.filter((d) => d.place_name.includes('초등학교'));
}

// 공원 키워드 결과 중 실제 공원만 남긴다(카카오 공원 키워드 검색이 이름에 "공원"이
// 포함되기만 하면 걸리는 느슨한 검색이라 아파트/화장실 등이 섞여 들어옴, KakaoPlaces.tsx
// 기존 확인 사실 재사용).
export function filterParks(docs: KakaoDocument[]): KakaoDocument[] {
  return filterExcludedNames(docs);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
