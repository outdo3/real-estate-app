import { callGeminiJSON, callGeminiText } from './gemini';
import { fetchBuildingRegistryInfo, formatParking } from './apt-building-info';
import { getCompactAreaLabel } from './area-utils';
import { REGION_DATA } from './regions';

export type AiIntent = 'condition_search' | 'regional_stats' | 'compare';

interface Classification {
  intent: AiIntent;
  sido: string | null;
  sigungu: string | null;
  maxPriceEok: number | null;
  minParkingPerHousehold: number | null;
  minTotalHouseholds: number | null;
  newBuildOnly: boolean;
  nearElementarySchool: boolean;
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
      type: 'BOOLEAN',
      description: '"초등학교 가까운", "초품아", "학교 가까운", "학군" 같은 표현이 있으면 true — 도보권 초등학교가 있는 단지만 찾는다는 뜻.',
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

예시:
- "부산 서구 5억 이하 신축 아파트" → condition_search, maxPriceEok=5, newBuildOnly=true
- "부산 서구 주차 넉넉한 아파트" → condition_search, minParkingPerHousehold=${AMPLE_PARKING_MIN_PER_HOUSEHOLD}
- "부산 서구 대단지 아파트" → condition_search, minTotalHouseholds=${LARGE_COMPLEX_MIN_HOUSEHOLDS}
- "부산 서구 초품아 아파트 찾아줘" → condition_search, nearElementarySchool=true
- "부산 서구 최근 거래량 보여줘" → regional_stats (특정 단지 조건 없이 지역 전체 추세)
- "부산 서구 요즘 시세 어때" → regional_stats
- "대신더샵과 대신롯데캐슬 비교해줘" → compare (구체적 단지 2개 비교)

사용자 질문: "${query}"`;
  return callGeminiJSON<Classification>(prompt, CLASSIFY_SCHEMA);
}

export { normalizeSidoName };

// ── 조건 검색 ──

export interface NearestSchoolInfo {
  name: string;
  distanceM: number;
  walkMinutes: number;
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

// 반경 500m(도보 약 7분) 이내에서 가장 가까운 초등학교를 카카오 로컬 REST API로 찾는다.
// runConditionSearch가 서버(Route Handler)에서 실행되므로 window.kakao JS SDK를 쓸 수
// 없어(KakaoPlaces.tsx와 달리) REST 카테고리 검색을 직접 호출한다 — 이 JS 키는 KA/Origin
// 헤더 없이 REST 호출하면 401을 반환한다(api/transactions/route.ts의 geocodeApt와 동일하게
// 실측 확인된 우회법을 그대로 재사용).
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
    return { name: school.place_name, distanceM, walkMinutes: Math.max(1, Math.ceil(distanceM / 80)) };
  } catch (e) {
    return null;
  }
}

export async function runConditionSearch(
  lawdCd: string,
  conditions: Pick<Classification, 'maxPriceEok' | 'minParkingPerHousehold' | 'minTotalHouseholds' | 'newBuildOnly' | 'nearElementarySchool'>,
  requestUrl: string
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

  let candidates = Array.from(byComplex.values()).filter((t) => {
    if (conditions.maxPriceEok != null && t.dealAmount > conditions.maxPriceEok * 10000) return false;
    if (conditions.newBuildOnly) {
      const buildYear = parseInt(t.buildYear, 10);
      if (isNaN(buildYear) || buildYear < NEW_BUILD_MIN_YEAR) return false;
    }
    return true;
  });

  // 최신 거래일 순으로 정렬 후 상위 후보로 제한 — 주차/세대수/초등학교 조건이 있으면
  // 후보마다 건축물대장·카카오 API를 실시간 조회해야 해서(캐시 미스 시) 무제한으로 두면
  // 응답이 느려진다.
  const needsPerCandidateLookup =
    conditions.minParkingPerHousehold != null || conditions.minTotalHouseholds != null || conditions.nearElementarySchool;
  candidates.sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());
  candidates = candidates.slice(0, needsPerCandidateLookup ? 15 : 30);

  const results: ConditionSearchComplex[] = await Promise.all(
    candidates.map(async (t) => {
      let parkingInfo: string | null = null;
      let parkingPerHousehold: number | null = null;
      let totalHouseholds: number | null = null;

      if ((conditions.minParkingPerHousehold != null || conditions.minTotalHouseholds != null) && t.jibun) {
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
    filtered = filtered
      .filter((r) => r.nearestSchool != null)
      .sort((a, b) => a.nearestSchool!.distanceM - b.nearestSchool!.distanceM);
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

// "국민평형" 84㎡(전용 80~89㎡, 공급 약 34평) 밴드 — area-utils.ts의 KNOWN_SUPPLY_PYUNG과
// 동일한 구간을 그대로 쓴다.
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

  const toOption = ([area, v]: [string, { latest: any; count: number }]): CompareAreaOption => ({
    area,
    label: getCompactAreaLabel(parseFloat(area)),
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
export async function generateBriefing(
  intent: AiIntent,
  groundedSummary: string,
  options?: { requireSchoolMention?: boolean }
): Promise<string> {
  // 검색 의도가 "초등학교 가까운 단지"였다면, 가격/준공년도만 나열하는 기존 템플릿식
  // 답변 대신 반드시 배정/인근 초등학교 이름과 도보 거리·시간을 문장에 포함하도록
  // 명시적으로 지시한다 — 데이터 요약(groundedSummary)에 이미 그 정보가 들어있으므로
  // 지어내는 게 아니라 "빠뜨리지 말라"는 가드레일이다.
  const schoolGuardrail = options?.requireSchoolMention
    ? '\n\n중요: 이 검색은 "초등학교 가까운 단지"를 찾는 질문이었다. 각 단지를 설명할 때 가격·준공년도만 나열하지 말고, 반드시 데이터 요약에 있는 초등학교 이름과 도보 거리/시간을 함께 언급해라(예: "OO초등학교까지 도보 약 3분(200m) 거리").'
    : '';

  const prompt = `너는 한국 부동산 서비스 "이집"의 AI 브리핑 작성자다. 아래는 실제로 조회된 데이터 요약이다. 이 안에 있는 사실만 근거로 자연스러운 한국어 브리핑을 2~4문장으로 작성해라. 데이터에 없는 숫자나 추정치를 절대 지어내지 마라. 마크다운 기호(*, # 등)는 쓰지 마라.${schoolGuardrail}

[데이터 요약]
${groundedSummary}`;
  const text = await callGeminiText(prompt);
  return text || '데이터를 확인했지만 요약을 생성하지 못했습니다. 아래 결과를 참고해주세요.';
}
