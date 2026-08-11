import { callGeminiJSON, callGeminiText } from './gemini';
import { fetchBuildingRegistryInfo, formatParking } from './apt-building-info';
import { REGION_DATA } from './regions';

export type AiIntent = 'condition_search' | 'regional_stats' | 'compare';

interface Classification {
  intent: AiIntent;
  sido: string | null;
  sigungu: string | null;
  maxPriceEok: number | null;
  minParkingPerHousehold: number | null;
  newBuildOnly: boolean;
  compareTargetA: string | null;
  compareTargetB: string | null;
}

const CLASSIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: {
      type: 'STRING',
      enum: ['condition_search', 'regional_stats', 'compare'],
      description:
        'condition_search: 조건(가격/주차/신축 등)에 맞는 단지를 찾아달라는 질문. regional_stats: 특정 지역의 거래량/시세 통계를 물어보는 질문. compare: 특정 두 단지를 비교해달라는 질문.',
    },
    sido: { type: 'STRING', nullable: true, description: '시/도 정식 명칭(예: "부산광역시"). 언급 없으면 null.' },
    sigungu: { type: 'STRING', nullable: true, description: '시/군/구 이름(예: "서구"). 언급 없으면 null.' },
    maxPriceEok: { type: 'NUMBER', nullable: true, description: '"5억 이하" 같은 최대 매매가 조건(억 단위 숫자). 없으면 null.' },
    minParkingPerHousehold: { type: 'NUMBER', nullable: true, description: '"주차 1.2대 이상" 같은 세대당 최소 주차대수 조건. 없으면 null.' },
    newBuildOnly: { type: 'BOOLEAN', description: '"신축"을 요구하는지(준공 5년 이내).' },
    compareTargetA: { type: 'STRING', nullable: true, description: 'compare 의도일 때 비교 대상 단지명 1. 아니면 null.' },
    compareTargetB: { type: 'STRING', nullable: true, description: 'compare 의도일 때 비교 대상 단지명 2. 아니면 null.' },
  },
  required: ['intent', 'newBuildOnly'],
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
- 가격/주차대수/평형/신축 여부 등 "조건"을 걸고 단지를 찾아달라는 질문 → condition_search. 가격 조건("5억 이하")이나 신축 조건이 하나라도 있으면 거의 항상 condition_search다.
- "거래량", "시세 추이", "가격 변동", "통계" 등 특정 지역 전체의 추세/통계를 물어보는 질문(비교 대상 단지가 없는 경우) → regional_stats.
- 두 개의 구체적인 단지명이 함께 언급되고 서로 비교해달라는 질문 → compare.

예시:
- "부산 서구 5억 이하 신축 아파트" → condition_search (가격+신축 조건이 명시됨)
- "부산 서구 주차 1.2대 이상인 아파트 알려줘" → condition_search (주차 조건이 명시됨)
- "부산 서구 최근 거래량 보여줘" → regional_stats (특정 단지 조건 없이 지역 전체 추세)
- "부산 서구 요즘 시세 어때" → regional_stats
- "대신더샵과 대신롯데캐슬 비교해줘" → compare (구체적 단지 2개 비교)

사용자 질문: "${query}"`;
  return callGeminiJSON<Classification>(prompt, CLASSIFY_SCHEMA);
}

export { normalizeSidoName };

// ── 조건 검색 ──

export interface ConditionSearchComplex {
  name: string;
  dong: string;
  price: string;
  dealAmount: number;
  buildYear: string | null;
  tradeDate: string;
  parkingInfo: string | null;
  parkingPerHousehold: number | null;
}

export async function runConditionSearch(
  lawdCd: string,
  conditions: Pick<Classification, 'maxPriceEok' | 'minParkingPerHousehold' | 'newBuildOnly'>,
  requestUrl: string
): Promise<ConditionSearchComplex[]> {
  const txUrl = new URL(`/api/transactions?type=apt&lawdCd=${lawdCd}&months=12`, requestUrl);
  const res = await fetch(txUrl);
  const trades = await res.json();
  if (!Array.isArray(trades)) return [];

  const currentYear = new Date().getFullYear();

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
      if (isNaN(buildYear) || currentYear - buildYear > 5) return false;
    }
    return true;
  });

  // 최신 거래일 순으로 정렬 후 상위 후보로 제한 — 특히 주차 조건이 있으면 후보마다
  // 건축물대장을 실시간 조회해야 해서(캐시 미스 시) 무제한으로 두면 응답이 느려진다.
  candidates.sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());
  candidates = candidates.slice(0, conditions.minParkingPerHousehold != null ? 15 : 30);

  const results: ConditionSearchComplex[] = await Promise.all(
    candidates.map(async (t) => {
      let parkingInfo: string | null = null;
      let parkingPerHousehold: number | null = null;

      if (conditions.minParkingPerHousehold != null && t.jibun) {
        const registry = await fetchBuildingRegistryInfo(t.name, lawdCd, t.dong, t.jibun);
        if (registry?.parkingCount && registry.totalHouseholds) {
          parkingPerHousehold = registry.parkingCount / registry.totalHouseholds;
          parkingInfo = formatParking(registry.parkingCount, registry.totalHouseholds);
        }
      }

      return {
        name: t.name,
        dong: t.dong,
        price: t.price,
        dealAmount: t.dealAmount,
        buildYear: t.buildYear || null,
        tradeDate: t.tradeDate,
        parkingInfo,
        parkingPerHousehold,
      };
    })
  );

  // 주차 조건이 있으면 실제로 조건을 만족하는 게 확인된 단지만 남긴다 — 데이터가 없어
  // 확인 못 한 단지를 "만족한다"고 지어내지 않는다.
  const filtered =
    conditions.minParkingPerHousehold != null
      ? results.filter((r) => r.parkingPerHousehold != null && r.parkingPerHousehold >= conditions.minParkingPerHousehold!)
      : results;

  return filtered.slice(0, 10);
}

// ── 지역 통계 ──

export interface RegionalStatsData {
  chartData: { month: string; volume: number; saleIndex: number | null; jeonseIndex: number | null }[];
  volume: number;
  volumeChange: number;
  jeonseRate: number | null;
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
  };
}

// ── 단지 1:1 비교 ──

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
}

async function fetchCompareTarget(name: string, lawdCd: string | null, requestUrl: string): Promise<CompareComplexData> {
  // lawdCd가 없으면(질문 문장에 지역이 명시되지 않은 경우) 아예 쿼리에서 빼고 /api/apt/[name]가
  // 단지명 자체를 지오코딩해서 정확한 지역을 알아내게 한다. 여기서 화면에 현재 선택된 지역
  // (예: 기본값 서울 강남구)을 강제로 넘기면, 비교 대상 두 단지가 실제로는 부산에 있어도
  // 강남구 안에서만 찾다가 "정보 없음"이 뜨거나 — 더 나쁘게는 같은 브랜드명의 강남구 단지
  // (예: 다른 "대신롯데캐슬")가 엉뚱하게 매칭되는 문제가 실측으로 확인됐다.
  const lawdCdQuery = lawdCd ? `&lawdCd=${lawdCd}` : '';
  const tradesUrl = new URL(`/api/apt/${encodeURIComponent(name)}?type=apt&period=12${lawdCdQuery}`, requestUrl);
  const tradesRes = await fetch(tradesUrl);
  const tradesJson = await tradesRes.json();
  const trades = Array.isArray(tradesJson.trades) ? tradesJson.trades : [];
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

  return {
    name,
    latestPrice: latest?.priceStr || null,
    latestArea: latest?.area || null,
    tradeCount: trades.length,
    totalHouseholds: info?.['세대수'] || null,
    parking: info?.['총주차대수'] || null,
    far: info?.['용적률'] || null,
    bcr: info?.['건폐율'] || null,
    buildYear: latest?.buildYear ? `${latest.buildYear}년` : (info?.['사용승인일'] || null),
    facilities: Array.isArray(facilitiesJson.facilities) ? facilitiesJson.facilities : [],
  };
}

export async function runCompare(
  targetA: string,
  targetB: string,
  lawdCd: string | null,
  requestUrl: string
): Promise<[CompareComplexData, CompareComplexData]> {
  const [a, b] = await Promise.all([
    fetchCompareTarget(targetA, lawdCd, requestUrl),
    fetchCompareTarget(targetB, lawdCd, requestUrl),
  ]);
  return [a, b];
}

// ── 브리핑 생성 ──
// 실제로 조회된 데이터만 요약해서 넘기고, "이 안에서만 이야기하라"고 명시해 지어내는 걸
// 막는다.
export async function generateBriefing(intent: AiIntent, groundedSummary: string): Promise<string> {
  const prompt = `너는 한국 부동산 서비스 "이집"의 AI 브리핑 작성자다. 아래는 실제로 조회된 데이터 요약이다. 이 안에 있는 사실만 근거로 자연스러운 한국어 브리핑을 2~4문장으로 작성해라. 데이터에 없는 숫자나 추정치를 절대 지어내지 마라. 마크다운 기호(*, # 등)는 쓰지 마라.

[데이터 요약]
${groundedSummary}`;
  const text = await callGeminiText(prompt);
  return text || '데이터를 확인했지만 요약을 생성하지 못했습니다. 아래 결과를 참고해주세요.';
}
