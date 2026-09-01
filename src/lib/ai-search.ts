import { callGeminiJSON, callGeminiText } from './gemini';
import { fetchBuildingRegistryInfo, formatParking } from './apt-building-info';
import { getUniqueAreaLabels, resolveAreaLabel } from './area-utils';
import { REGION_DATA } from './regions';

export type AiIntent = 'condition_search' | 'regional_stats' | 'compare';
export type SortIntent = 'recent' | 'price_asc' | 'price_desc';

interface Classification {
  intent: AiIntent;
  sido: string | null;
  sigungu: string | null;
  maxPriceEok: number | null;
  minParkingPerHousehold: number | null;
  minTotalHouseholds: number | null;
  newBuildOnly: boolean;
  nearElementarySchool: boolean;
  complexName: string | null;
  compareTargetA: string | null;
  compareTargetB: string | null;
}

// "신축"의 기준 연도. 아파트 브리핑(apt-brief.ts)의 5년 기준과는 별개로, 이 파서는
// 검색 재현율을 넓히기 위한 사용자 지정값(build_year >= 2018)을 그대로 쓴다 — 이후 값이
// 낡으면(예: 2030년에도 2018년이면 "신축"이 12년차가 됨) 이 상수 하나만 고치면 된다.
const NEW_BUILD_MIN_YEAR = 2018;
// "대단지"의 기준 세대수.
const LARGE_COMPLEX_MIN_HOUSEHOLDS = 1000;
// "주차 넉넉/편리/스트레스 없는" 같은 정성적 표현을 숫자 조건이 없을 때 채워 넣을 기본값.
const AMPLE_PARKING_MIN_PER_HOUSEHOLD = 1.25;

const CLASSIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: {
      type: 'STRING',
      enum: ['condition_search', 'regional_stats', 'compare'],
      description:
        'condition_search: 조건(가격/주차/신축/세대수/초등학교 등)에 맞는 단지를 찾아달라는 질문. regional_stats: 특정 지역의 거래량/시세 통계를 물어보는 질문. compare: 특정 두 단지를 비교해달라는 질문.',
    },
    sido: { type: 'STRING', nullable: true, description: '시/도 정식 명칭(예: "부산광역시"). 언급 없으면 null.' },
    sigungu: { type: 'STRING', nullable: true, description: '시/군/구 이름(예: "서구"). 언급 없으면 null.' },
    maxPriceEok: { type: 'NUMBER', nullable: true, description: '"5억 이하", "5억 미만" 같은 최대 매매가 조건(억 단위 숫자). 없으면 null.' },
    minParkingPerHousehold: {
      type: 'NUMBER',
      nullable: true,
      description: `세대당 최소 주차대수 조건. "주차 1.2대 이상"처럼 숫자가 명시되면 그 숫자를 그대로 쓰고, "주차 넉넉한", "주차 편리한", "주차 스트레스 없는"처럼 숫자 없이 정성적으로만 표현되면 ${AMPLE_PARKING_MIN_PER_HOUSEHOLD}를 채워라. 주차 언급이 아예 없으면 null.`,
    },
    minTotalHouseholds: {
      type: 'NUMBER',
      nullable: true,
      description: `"대단지", "단지 크기 큰" 같은 표현이 있으면 ${LARGE_COMPLEX_MIN_HOUSEHOLDS}를 채워라(숫자가 별도로 명시되면 그 숫자 사용). 언급 없으면 null.`,
    },
    newBuildOnly: {
      type: 'BOOLEAN',
      description: `"신축", "새 아파트", "지어진 지 얼마 안 된" 같은 표현이 있으면 true(준공년도 ${NEW_BUILD_MIN_YEAR}년 이후 기준으로 필터링됨).`,
    },
    nearElementarySchool: {
      // SCHOOL V2-C5-A §4: 이 boolean은 "도보 N분 이내" 같은 구체적 분단위 조건을
      // 별도로 받지 않는다 — "초품아"든 "도보 10분 이내 학교"든 전부 이 하나의 flag로
      // 뭉뚱그려지고, 실제 필터는 findNearestElementarySchool의 고정 500m 반경
      // (ELEMENTARY_SCHOOL_RADIUS_M)만 적용된다. 사용자가 특정 분(分)을 말해도 그
      // 숫자를 검증하거나 응답에서 "그 조건을 만족한다"고 되짚어 말하지 않는다 —
      // 매칭된 단지는 항상 실제 직선거리(distanceM)로만 설명된다(walkMinutes 필드
      // 제거됨). 분단위 조건을 정말 검증하려면 실제 보행경로 API가 필요하다
      // (SCHOOL V2-C5-C), 이번 STEP은 그 미지원 상태를 정직하게 유지하는 것까지만 한다.
      type: 'BOOLEAN',
      description: '"초등학교 가까운", "초품아", "학교 가까운", "학군" 같은 표현이 있으면 true — 도보권 초등학교가 있는 단지만 찾는다는 뜻.',
    },
    complexName: {
      type: 'STRING',
      nullable: true,
      description:
        'condition_search 의도이면서 특정 단지 하나를 콕 집어 찾는 질문이면(비교가 아니고, 여러 단지를 조건으로 찾는 것도 아닌 경우) 그 단지명만 추출해라. 지역명 접두어(예: "해운대", "서구")는 단지명에서 제외하고 순수 단지명만 넣어라(예: "해운대 동백두산위브더제니스" → "동백두산위브더제니스"). 특정 단지명이 언급되지 않았으면 null.',
    },
    compareTargetA: { type: 'STRING', nullable: true, description: 'compare 의도일 때 비교 대상 단지명 1. 아니면 null.' },
    compareTargetB: { type: 'STRING', nullable: true, description: 'compare 의도일 때 비교 대상 단지명 2. 아니면 null.' },
  },
  required: ['intent', 'newBuildOnly', 'nearElementarySchool'],
};

// 시/도 축약형(부산, 서울 등)을 REGION_DATA의 정식 명칭으로 정규화한다. Gemini가 이미
// 정식 명칭으로 반환하는 경우가 많지만(실측 확인), 축약형이 섞여 들어와도
// resolveLawdCdByNames가 정확히 매칭되도록 방어적으로 한 번 더 보정한다.
function normalizeSidoName(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (REGION_DATA[trimmed]) return trimmed;
  const found = Object.keys(REGION_DATA).find((full) => full.startsWith(trimmed) || trimmed.startsWith(full.slice(0, 2)));
  return found || null;
}

export async function classifyQuery(query: string): Promise<Classification | null> {
  const prompt = `너는 한국 부동산 검색 서비스 "이집"의 질문 분류기다. 아래 사용자 질문을 분석해서 정해진 JSON 스키마로만 답해라. 실제로 문장에 없는 정보는 절대 추측해서 채우지 말고 null/false로 둬라.

분류 기준(중요):
- 가격/주차대수/평형/신축/세대수/초등학교 등 "조건"을 걸고 단지를 찾아달라는 질문 → condition_search. 이런 조건이 하나라도 있으면 거의 항상 condition_search다.
- "거래량", "시세 추이", "가격 변동", "통계" 등 특정 지역 전체의 추세/통계를 물어보는 질문(비교 대상 단지가 없는 경우) → regional_stats.
- 두 개의 구체적인 단지명이 함께 언급되고 서로 비교해달라는 질문 → compare.

모호한 표현을 정형화된 조건으로 바꾸는 규칙(각 필드 설명에도 있지만 다시 강조):
- "주차 넉넉/편리/스트레스 없는" → minParkingPerHousehold = ${AMPLE_PARKING_MIN_PER_HOUSEHOLD} (숫자가 따로 있으면 그 숫자 우선)
- "대단지", "단지 크기 큰" → minTotalHouseholds = ${LARGE_COMPLEX_MIN_HOUSEHOLDS}
- "신축", "새 아파트", "지어진 지 얼마 안 된" → newBuildOnly = true
- "초등학교 가까운", "초품아", "학교 가까운", "학군" → nearElementarySchool = true
- "5억 이하/미만" 같은 금액 표현 → maxPriceEok
- 특정 단지 하나만 콕 집어 찾는 질문(비교/조건 나열이 아니라 그 단지 자체를 찾는 질문) → complexName에 단지명(지역 접두어 제외)을 넣어라.

예시:
- "부산 서구 5억 이하 신축 아파트" → condition_search, maxPriceEok=5, newBuildOnly=true
- "부산 서구 주차 넉넉한 아파트" → condition_search, minParkingPerHousehold=${AMPLE_PARKING_MIN_PER_HOUSEHOLD}
- "부산 서구 대단지 아파트" → condition_search, minTotalHouseholds=${LARGE_COMPLEX_MIN_HOUSEHOLDS}
- "부산 서구 초품아 아파트 찾아줘" → condition_search, nearElementarySchool=true
- "해운대 동백두산위브더제니스" → condition_search, sigungu="해운대구", complexName="동백두산위브더제니스"
- "동백두산위브더제니스 알려줘" → condition_search, complexName="동백두산위브더제니스"
- "부산 서구 최근 거래량 보여줘" → regional_stats (특정 단지 조건 없이 지역 전체 추세)
- "부산 서구 요즘 시세 어때" → regional_stats
- "대신더샵과 대신롯데캐슬 비교해줘" → compare (구체적 단지 2개 비교)

사용자 질문: "${query}"`;
  return callGeminiJSON<Classification>(prompt, CLASSIFY_SCHEMA);
}

export { normalizeSidoName };

// 검색어 안에 명시적 정렬 키워드가 있는지 코드 레벨로 판별한다(LLM에 맡기지 않고 결정적으로
// 처리 — 정렬 기준은 사용자가 화면에서 바로 확인 가능한 결과라 오분류 리스크를 피한다).
// 명시적 키워드가 없으면 null을 반환하고, 호출부(runConditionSearch)는 이 경우 기본값인
// "세대수 내림차순(대단지 우선)"으로 정렬한다.
export function detectSortIntent(query: string): SortIntent | null {
  const q = query.replace(/\s+/g, '');
  if (/최신순|신축순|최근순/.test(q)) return 'recent';
  if (/비싼순|높은가격순|가격높은순/.test(q)) return 'price_desc';
  if (/가격순|저렴한순|낮은가격순|가격낮은순/.test(q)) return 'price_asc';
  return null;
}

// 검색어 맨 앞부분에 시/군/구 지역명이 포함돼 있는지 코드 레벨로 감지한다. classifyQuery의
// LLM 추출이 실패하거나(예: "해운대"처럼 정식 명칭 "해운대구"가 아닌 축약형이 단지명과
// 붙어 있어 LLM이 지역으로 인식하지 못한 경우) 놓친 부분을 결정적으로 보정하기 위함이다.
// 매칭된 지역 키워드를 뗀 나머지 문자열(remainder)은 단지명 후보로 쓸 수 있다.
export function detectLeadingRegionKeyword(
  query: string
): { sido: string; sigungu: string; remainder: string } | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  for (const [sido, gunguList] of Object.entries(REGION_DATA)) {
    for (const gungu of gunguList) {
      if (trimmed.startsWith(gungu)) {
        return { sido, sigungu: gungu, remainder: trimmed.slice(gungu.length).trim() };
      }
      // "해운대" → "해운대구"처럼 시/군/구 접미사를 뗀 축약형 접두어도 인식한다.
      const shortForm = gungu.replace(/(시|군|구)$/, '');
      if (shortForm.length >= 2 && trimmed.startsWith(shortForm)) {
        return { sido, sigungu: gungu, remainder: trimmed.slice(shortForm.length).trim() };
      }
    }
  }
  return null;
}

// 검색어/DB 단지명 매칭 시 공백 유무 차이를 흡수한다 — "해운대 동백두산위브더제니스"와
// "해운대동백두산위브더제니스" 둘 다 같은 정규화 문자열로 취급된다.
function normalizeComplexNameForMatch(name: string): string {
  return (name || '').replace(/\s+/g, '').replace(/아파트$/, '');
}

function complexNameMatches(candidateName: string, queryName: string): boolean {
  const a = normalizeComplexNameForMatch(candidateName);
  const b = normalizeComplexNameForMatch(queryName);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

// ── 조건 검색 ──

export interface NearestSchoolInfo {
  name: string;
  distanceM: number;
}

export interface ConditionSearchComplex {
  name: string;
  dong: string;
  price: string;
  dealAmount: number;
  buildYear: string | null;
  tradeDate: string;
  parkingInfo: string | null;
  parkingPerHousehold: number | null;
  totalHouseholds: number | null;
  nearestSchool: NearestSchoolInfo | null;
}

// 반경 500m 이내에서 가장 가까운 초등학교를 카카오 로컬 REST API로 찾는다.
// runConditionSearch가 서버(Route Handler)에서 실행되므로 window.kakao JS SDK를 쓸 수
// 없어(KakaoPlaces.tsx와 달리) REST 카테고리 검색을 직접 호출한다 — 이 JS 키는 KA/Origin
// 헤더 없이 REST 호출하면 401을 반환한다(api/transactions/route.ts의 geocodeApt와 동일하게
// 실측 확인된 우회법을 그대로 재사용).
//
// SCHOOL V2-C5-A: Kakao가 반환하는 distance는 직선거리다(실제 보행경로 아님). 이전에는
// 여기서 distance/80m로 "walkMinutes"를 만들어 반환했는데, 소비자 쪽(ai-search-client.tsx,
// api/ai-search/route.ts)이 그 값을 "도보 N분"으로 그대로 노출해 실제로 갖고 있지 않은
// 정확도를 가진 것처럼 보였다 — 그 변환을 아예 이 함수에서 제거했다. 도보/차량 소요시간이
// 필요하면 SCHOOL V2-C5-C(정식 보행경로 provider 연동) 이후에나 정직하게 추가할 수 있다.
const ELEMENTARY_SCHOOL_RADIUS_M = 500;

async function findNearestElementarySchool(lat: number, lng: number): Promise<NearestSchoolInfo | null> {
  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!kakaoKey) return null;
  try {
    const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=SC4&x=${lng}&y=${lat}&radius=${ELEMENTARY_SCHOOL_RADIUS_M}&sort=distance`;
    const res = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${kakaoKey}`,
        KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
        Origin: 'http://localhost:3000',
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const school = (data.documents || []).find((d: any) => (d.place_name || '').includes('초등학교'));
    if (!school) return null;
    const distanceM = Number(school.distance);
    if (isNaN(distanceM)) return null;
    return { name: school.place_name, distanceM };
  } catch (e) {
    return null;
  }
}

export async function runConditionSearch(
  lawdCd: string,
  conditions: Pick<Classification, 'maxPriceEok' | 'minParkingPerHousehold' | 'minTotalHouseholds' | 'newBuildOnly' | 'nearElementarySchool'>,
  requestUrl: string,
  options?: { complexName?: string | null; sortBy?: SortIntent | null }
): Promise<ConditionSearchComplex[]> {
  const txUrl = new URL(`/api/transactions?type=apt&lawdCd=${lawdCd}&months=12`, requestUrl);
  const res = await fetch(txUrl);
  const trades = await res.json();
  if (!Array.isArray(trades)) return [];

  // 단지(dong+name)별 최신 거래 1건만 남긴다 — /map 페이지와 동일한 dedup 방식.
  const byComplex = new Map<string, any>();
  for (const t of trades) {
    if (!t.dong || !t.name) continue;
    const key = `${t.dong}|${t.name}`;
    if (!byComplex.has(key)) byComplex.set(key, t);
  }

  const complexName = options?.complexName || null;
  let candidates = Array.from(byComplex.values()).filter((t) => {
    if (complexName && !complexNameMatches(t.name, complexName)) return false;
    if (conditions.maxPriceEok != null && t.dealAmount > conditions.maxPriceEok * 10000) return false;
    if (conditions.newBuildOnly) {
      const buildYear = parseInt(t.buildYear, 10);
      if (isNaN(buildYear) || buildYear < NEW_BUILD_MIN_YEAR) return false;
    }
    return true;
  });

  // 명시적 정렬 조건(최신순/가격순 등)이 없으면 기본값은 "세대수 내림차순(대단지 우선)"이라
  // 세대수 데이터가 항상 필요하다 — 주차/세대수 조건이 없어도 건축물대장 조회를 해야 한다.
  // 특정 단지명을 콕 집어 찾는 검색(complexName)도 세대수를 함께 보여주기 위해 조회한다.
  const explicitSortBy = options?.sortBy === 'recent' || options?.sortBy === 'price_asc' || options?.sortBy === 'price_desc';
  const needsHouseholdData =
    conditions.minParkingPerHousehold != null || conditions.minTotalHouseholds != null || !!complexName || !explicitSortBy;
  // 후보마다 건축물대장·카카오 API를 실시간 조회해야 해서(캐시 미스 시) 무제한으로 두면
  // 응답이 느려진다 — 단, 특정 단지명 검색은 애초에 후보가 소수이므로 자르지 않는다.
  const needsPerCandidateLookup = needsHouseholdData || conditions.nearElementarySchool;
  candidates.sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());
  if (!complexName) {
    candidates = candidates.slice(0, needsPerCandidateLookup ? 15 : 30);
  }

  const results: ConditionSearchComplex[] = await Promise.all(
    candidates.map(async (t) => {
      let parkingInfo: string | null = null;
      let parkingPerHousehold: number | null = null;
      let totalHouseholds: number | null = null;

      if (needsHouseholdData && t.jibun) {
        const registry = await fetchBuildingRegistryInfo(t.name, lawdCd, t.dong, t.jibun);
        if (registry?.totalHouseholds) totalHouseholds = registry.totalHouseholds;
        if (registry?.parkingCount && registry.totalHouseholds) {
          parkingPerHousehold = registry.parkingCount / registry.totalHouseholds;
          parkingInfo = formatParking(registry.parkingCount, registry.totalHouseholds);
        }
      }

      const nearestSchool =
        conditions.nearElementarySchool && t.lat && t.lng ? await findNearestElementarySchool(t.lat, t.lng) : null;

      return {
        name: t.name,
        dong: t.dong,
        price: t.price,
        dealAmount: t.dealAmount,
        buildYear: t.buildYear || null,
        tradeDate: t.tradeDate,
        parkingInfo,
        parkingPerHousehold,
        totalHouseholds,
        nearestSchool,
      };
    })
  );

  // 조건별로 실제 확인된 값만 남긴다 — 확인 못 한(데이터가 없는) 단지를 "만족한다"고
  // 지어내지 않는다. 초등학교 조건은 가까운 순으로 1차 정렬까지 함께 적용한다.
  let filtered = results;
  if (conditions.minParkingPerHousehold != null) {
    filtered = filtered.filter((r) => r.parkingPerHousehold != null && r.parkingPerHousehold >= conditions.minParkingPerHousehold!);
  }
  if (conditions.minTotalHouseholds != null) {
    filtered = filtered.filter((r) => r.totalHouseholds != null && r.totalHouseholds >= conditions.minTotalHouseholds!);
  }

  if (conditions.nearElementarySchool) {
    filtered = [...filtered]
      .filter((r) => r.nearestSchool != null)
      .sort((a, b) => a.nearestSchool!.distanceM - b.nearestSchool!.distanceM);
  } else if (options?.sortBy === 'recent') {
    filtered = [...filtered].sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());
  } else if (options?.sortBy === 'price_asc') {
    filtered = [...filtered].sort((a, b) => a.dealAmount - b.dealAmount);
  } else if (options?.sortBy === 'price_desc') {
    filtered = [...filtered].sort((a, b) => b.dealAmount - a.dealAmount);
  } else {
    // 기본 정렬: 세대수 내림차순(대단지 우선). 세대수를 확인하지 못한 단지는 뒤로 보낸다.
    filtered = [...filtered].sort((a, b) => (b.totalHouseholds ?? -1) - (a.totalHouseholds ?? -1));
  }

  return filtered.slice(0, 10);
}

// ── 지역 통계 ──

export interface VolumeRankingItem {
  rank: number;
  name: string;
  dong: string;
  dealCount: number;
}

export type StatsPeriodKey = '1' | '3' | '6' | '12';

export interface RegionalStatsData {
  chartData: { month: string; volume: number; saleIndex: number | null; jeonseIndex: number | null }[];
  volume: number;
  volumeChange: number;
  jeonseRate: number | null;
  volumeRanking: Record<StatsPeriodKey, VolumeRankingItem[]>;
  volumeByPeriod: Record<StatsPeriodKey, number>;
  // LAUNCH_TRUST_BLOCKERS_V1 — dashboard route가 MOLIT 조회 일부 실패를
  // partial/failedDistricts로 알려준다. 이걸 무시하면 실패로 인한 0건이 진짜
  // 0건처럼 문장으로 단정된다(§13 zero/no-data 원칙).
  partial: boolean;
}

export async function runRegionalStats(lawdCd: string, requestUrl: string): Promise<RegionalStatsData | null> {
  const dashboardUrl = new URL(`/api/stats/dashboard?lawdCd=${lawdCd}`, requestUrl);
  const res = await fetch(dashboardUrl);
  const json = await res.json();
  if (!json.success) return null;
  return {
    chartData: json.data.chartData,
    volume: json.data.summary.volume,
    volumeChange: json.data.summary.volumeChange,
    jeonseRate: json.data.jeonseRate,
    volumeRanking: json.data.volumeRanking,
    volumeByPeriod: json.data.volumeByPeriod,
    partial: !!json.data.partial,
  };
}

// ── 단지 1:1 비교 ──

export interface CompareAreaOption {
  area: string; // 원본 전용면적 문자열(예: "84.97")
  label: string; // 표시용("84(34평)")
  latestPrice: string;
  latestArea: string;
  tradeDate: string;
  tradeCount: number;
}

export interface CompareComplexData {
  name: string;
  latestPrice: string | null;
  latestArea: string | null;
  tradeCount: number;
  totalHouseholds: string | null;
  parking: string | null;
  far: string | null;
  bcr: string | null;
  buildYear: string | null;
  facilities: string[];
  // 평형별로 가장 최근 거래를 모아둔 목록 — 맨 앞(0번)이 기본 선택(국민평형 84㎡ 우선,
  // 없으면 거래가 가장 많은 대표 평형)이다. 위 latestPrice/latestArea/tradeCount는 이
  // 기본 선택과 동일한 값이라 기존 코드(브리핑 요약 등)는 그대로 동작한다.
  areaOptions: CompareAreaOption[];
}

// "국민평형" 84㎡(전용 80~89㎡) 밴드 — 국토부 실거래 통계상 가장 거래가 많은 표준 구간.
const NATIONAL_STANDARD_AREA_MIN = 80;
const NATIONAL_STANDARD_AREA_MAX = 89;

async function fetchCompareTarget(name: string, lawdCd: string | null, requestUrl: string): Promise<CompareComplexData & { resolvedLawdCd: string }> {
  // lawdCd가 없으면(질문 문장에 지역이 명시되지 않은 경우) 아예 쿼리에서 빼고 /api/apt/[name]가
  // 단지명 자체를 지오코딩해서 정확한 지역을 알아내게 한다. 여기서 화면에 현재 선택된 지역
  // (예: 기본값 서울 강남구)을 강제로 넘기면, 비교 대상 두 단지가 실제로는 부산에 있어도
  // 강남구 안에서만 찾다가 "정보 없음"이 뜨거나 — 더 나쁘게는 같은 브랜드명의 강남구 단지
  // (예: 다른 "대신롯데캐슬")가 엉뚱하게 매칭되는 문제가 실측으로 확인됐다.
  const lawdCdQuery = lawdCd ? `&lawdCd=${lawdCd}` : '';
  const tradesUrl = new URL(`/api/apt/${encodeURIComponent(name)}?type=apt&period=12${lawdCdQuery}`, requestUrl);
  const tradesRes = await fetch(tradesUrl);
  const tradesJson = await tradesRes.json();
  const trades: any[] = Array.isArray(tradesJson.trades) ? tradesJson.trades : [];
  const latest = trades[0];

  const dong = latest?.dong || '';
  const jibun = latest?.jibun || '';
  // /api/apt/[name]가 실제로 사용한(지오코딩/DB로 알아낸) lawdCd를 신뢰한다 — 원래 넘겼던
  // (또는 비어있던) lawdCd를 그대로 다시 쓰면 세대수/주차 등 정보 조회가 트레이드 조회와
  // 다른 지역을 보게 되는 불일치가 생긴다.
  const resolvedLawdCd = tradesJson.lawdCd || lawdCd || '';

  const infoUrl = new URL(
    `/api/apt/${encodeURIComponent(name)}/info?lawdCd=${resolvedLawdCd}&dong=${encodeURIComponent(dong)}&jibun=${encodeURIComponent(jibun)}`,
    requestUrl
  );
  const facilitiesUrl = new URL(`/api/apt/${encodeURIComponent(name)}/facilities?dong=${encodeURIComponent(dong)}`, requestUrl);

  const [infoRes, facilitiesRes] = await Promise.all([fetch(infoUrl), fetch(facilitiesUrl)]);
  const infoJson = await infoRes.json();
  const facilitiesJson = await facilitiesRes.json();
  const info: Record<string, string> | null = infoJson.info || null;

  // 평형별(전용면적 원본 문자열 기준)로 묶어서 각 평형의 가장 최근 거래 하나씩만 남긴다.
  // trades는 이미 최신순 정렬되어 있으므로(각 API route에서 정렬됨) 먼저 만난 게 최신이다.
  const byArea = new Map<string, { latest: any; count: number }>();
  for (const t of trades) {
    if (!t.area) continue;
    const existing = byArea.get(t.area);
    if (existing) existing.count += 1;
    else byArea.set(t.area, { latest: t, count: 1 });
  }
  const areaEntries = Array.from(byArea.entries());
  // 기본 선택: 국민평형(전용 80~89㎡) 밴드 안에서 거래가 가장 많은 평형 → 없으면 전체
  // 중 거래가 가장 많은(가장 대표적인) 평형.
  const nationalStandard = areaEntries
    .filter(([area]) => {
      const m2 = parseFloat(area);
      return m2 >= NATIONAL_STANDARD_AREA_MIN && m2 <= NATIONAL_STANDARD_AREA_MAX;
    })
    .sort((a, b) => b[1].count - a[1].count)[0];
  const mostTraded = areaEntries.sort((a, b) => b[1].count - a[1].count)[0];
  const defaultEntry = nationalStandard || mostTraded;

  // areaOptions는 사용자가 이 단지 안에서 평형을 골라 비교할 수 있는 선택지 목록이라
  // AreaSelector 칩과 동일한 "같은 목록 안 라벨 충돌" 문제가 생길 수 있다 — 이 단지의
  // areaEntries 전체를 기준으로 충돌 해소 라벨을 만든다(/apt/[name]과 별개 계산이라
  // 완전히 동일한 문자열이 나오리라는 보장은 없지만, 같은 정책·같은 함수를 쓴다).
  const areaLabels = getUniqueAreaLabels(areaEntries.map(([area]) => parseFloat(area)));

  const toOption = ([area, v]: [string, { latest: any; count: number }]): CompareAreaOption => ({
    area,
    label: resolveAreaLabel(parseFloat(area), areaLabels),
    latestPrice: v.latest.priceStr,
    latestArea: v.latest.area,
    tradeDate: v.latest.tradeDate,
    tradeCount: v.count,
  });

  const areaOptions: CompareAreaOption[] = defaultEntry
    ? [defaultEntry, ...areaEntries.filter(([area]) => area !== defaultEntry[0])].map(toOption)
    : [];

  return {
    name,
    latestPrice: areaOptions[0]?.latestPrice ?? (latest?.priceStr || null),
    latestArea: areaOptions[0]?.latestArea ?? (latest?.area || null),
    tradeCount: trades.length,
    totalHouseholds: info?.['세대수'] || null,
    parking: info?.['총주차대수'] || null,
    far: info?.['용적률'] || null,
    bcr: info?.['건폐율'] || null,
    buildYear: latest?.buildYear ? `${latest.buildYear}년` : (info?.['사용승인일'] || null),
    facilities: Array.isArray(facilitiesJson.facilities) ? facilitiesJson.facilities : [],
    areaOptions,
    resolvedLawdCd,
  };
}

export async function runCompare(
  targetA: string,
  targetB: string,
  lawdCd: string | null,
  requestUrl: string
): Promise<[CompareComplexData, CompareComplexData]> {
  if (lawdCd) {
    const [a, b] = await Promise.all([fetchCompareTarget(targetA, lawdCd, requestUrl), fetchCompareTarget(targetB, lawdCd, requestUrl)]);
    return [a, b];
  }

  // 질문에 지역이 없는 경우: 두 단지를 각각 독립적으로 지오코딩하면 우연히 동명인 타
  // 지역 단지가 섞일 위험이 있다(실측 사례: "대신롯데캐슬"이 부산 서구와 서울 강남구
  // 양쪽에 실재함 — 지오코딩이 무작위로 강남구 쪽을 찾아버림). 사용자가 비교하려는 두
  // 단지는 대개 같은 동네인 경우가 많다는 휴리스틱으로, A를 먼저 독립 지오코딩해 지역을
  // 알아낸 뒤 B는 그 지역 안에서 먼저 찾아보고, 실거래가 없으면(그 지역엔 진짜 없는
  // 경우) B도 독립적으로 지오코딩한다.
  const a = await fetchCompareTarget(targetA, null, requestUrl);
  let b = await fetchCompareTarget(targetB, a.resolvedLawdCd || null, requestUrl);
  if (b.tradeCount === 0 && a.resolvedLawdCd) {
    b = await fetchCompareTarget(targetB, null, requestUrl);
  }
  return [a, b];
}

// ── 브리핑 생성 ──
// 실제로 조회된 데이터만 요약해서 넘기고, "이 안에서만 이야기하라"고 명시해 지어내는 걸
// 막는다.
export interface BriefingFallbackComplex {
  name: string;
  totalHouseholds: number | null;
  price: string;
}

export async function generateBriefing(
  intent: AiIntent,
  groundedSummary: string,
  options?: {
    requireSchoolMention?: boolean;
    // 답변 맨 앞에 반드시 포함해야 하는 안내 문장(예: "부산 서구 5억 미만 단지 중 세대수가
    // 많은 대표 대단지 목록입니다.") — Gemini 프롬프트 지시뿐 아니라, Gemini 호출이
    // 실패했을 때의 결정적 폴백 문장으로도 그대로 재사용된다.
    leadInSentence?: string;
    // Gemini 호출이 실패(키 미설정/네트워크 오류/빈 응답 등)해도 "요약 생성 실패" 문구
    // 대신 실제 DB 조회 결과로 사람이 읽을 수 있는 요약을 직접 구성하기 위한 데이터.
    fallbackComplexes?: BriefingFallbackComplex[];
  }
): Promise<string> {
  // 검색 의도가 "초등학교 가까운 단지"였다면, 가격/준공년도만 나열하는 기존 템플릿식
  // 답변 대신 반드시 배정/인근 초등학교 이름과 거리를 문장에 포함하도록 명시적으로
  // 지시한다 — 데이터 요약(groundedSummary)에 이미 그 정보가 들어있으므로 지어내는 게
  // 아니라 "빠뜨리지 말라"는 가드레일이다.
  //
  // SCHOOL V2-C5-A: 실제 보행경로 API가 없는 상태라 "도보 N분"을 지시하면 Gemini가
  // 직선거리를 실제 도보시간처럼 서술하게 된다 — "직선거리"라는 사실을 명시하도록
  // 바꿨다(데이터 요약 자체도 더 이상 walkMinutes를 담지 않는다, §4 api/ai-search/route.ts).
  const schoolGuardrail = options?.requireSchoolMention
    ? '\n\n중요: 이 검색은 "초등학교 가까운 단지"를 찾는 질문이었다. 각 단지를 설명할 때 가격·준공년도만 나열하지 말고, 반드시 데이터 요약에 있는 초등학교 이름과 직선거리를 함께 언급해라(예: "OO초등학교까지 직선거리 약 200m"). "도보 N분"처럼 실제 보행경로가 아닌 값을 시간으로 표현하지 마라.'
    : '';
  const leadInGuardrail = options?.leadInSentence
    ? `\n\n중요: 답변 맨 앞 문장으로 반드시 이 문장을 그대로(토씨 하나 바꾸지 말고) 포함해라: "${options.leadInSentence}"`
    : '';

  const prompt = `너는 한국 부동산 서비스 "이집"의 AI 브리핑 작성자다. 아래는 실제로 조회된 데이터 요약이다. 이 안에 있는 사실만 근거로 자연스러운 한국어 브리핑을 2~4문장으로 작성해라. 데이터에 없는 숫자나 추정치를 절대 지어내지 마라. 마크다운 기호(*, # 등)는 쓰지 마라.${schoolGuardrail}${leadInGuardrail}

[데이터 요약]
${groundedSummary}`;
  const text = await callGeminiText(prompt);
  if (text) return text;

  // Gemini 호출 실패 시의 가드레일: "요약을 생성하지 못했습니다" 같은 무의미한 실패
  // 문구 대신, 이미 DB/공공데이터에서 확인된 목록으로 결정적 요약 문장을 직접 구성한다.
  if (options?.fallbackComplexes && options.fallbackComplexes.length > 0) {
    const list = options.fallbackComplexes
      .slice(0, 5)
      .map((c) => `${c.name}(${c.totalHouseholds ? `${c.totalHouseholds.toLocaleString('ko-KR')}세대` : '세대수 정보 없음'}, 최근 실거래 ${c.price})`)
      .join(', ');
    const prefix = options.leadInSentence ? `${options.leadInSentence} ` : '';
    return `${prefix}${list}`;
  }

  return '데이터를 확인했지만 요약을 생성하지 못했습니다. 아래 결과를 참고해주세요.';
}
