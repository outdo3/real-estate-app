// STEP SCORE S2B — 시세 raw feature 수집. 아파트마다 개별 호출하지 않고(§19 지시)
// 기존 fetchMolitData()를 구·군+월 단위로 호출해 지역 전체 거래를 한 번에 받은 뒤,
// 이미 파싱돼 있는 item.aptSeq(§23 — 이름 fuzzy matching 없이 MOLIT 원본 aptSeq로
// 직접 연결, src/lib/api-molit.ts에서 실측 확인된 필드)로 그룹핑한다.
import { fetchMolitData } from '@/lib/api-molit';

export interface MolitTradeRaw {
  aptSeq: string | null;
  excluUseArea: number | null;
  dealAmount: number;
  dealDate: string; // "YYYY-MM-DD"
  dealCanceled: boolean;
}

// dealYmd(YYYYMM) 목록 생성 — refDate 기준 최근 N개월(당월 제외, 완결된 달만).
export function recentMonths(refDate: Date, count: number): string[] {
  const months: string[] = [];
  const d = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  for (let i = 1; i <= count; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(`${m.getFullYear()}${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

export async function fetchRegionMonthTrades(lawdCd: string, dealYmd: string): Promise<{ ok: boolean; trades: MolitTradeRaw[]; errorDetail?: string }> {
  const items = await fetchMolitData({ lawdCd, dealYmd, type: 'apt' });
  // fetchMolitData는 실패 시 name에 "API 에러:"가 포함된 1건짜리 에러 placeholder를
  // 반환한다(api-molit.ts 기존 관례) — 정상 거래 배열과 구분한다.
  if (items.length === 1 && String((items[0] as any).name || '').startsWith('API 에러')) {
    return { ok: false, trades: [], errorDetail: (items[0] as any).info };
  }
  const trades: MolitTradeRaw[] = items.map((item: any) => ({
    aptSeq: item.aptSeq ?? null,
    excluUseArea: item.excluUseArea ?? null,
    dealAmount: item.dealAmount ?? 0,
    dealDate: item.dealDate,
    dealCanceled: item.dealCanceled === true,
  }));
  return { ok: true, trades };
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(raw); // schema medianPricePerM2_12m는 Int
}

export interface MarketFeatureAggregate {
  aptSeq: string;
  latestTradePrice: number | null; // 만원
  latestTradeDate: string | null;
  medianPricePerM2_12m: number | null; // 만원/㎡
  transactionCount12m: number;
}

// 거래금액(dealAmount)은 api-molit.ts formatKoreanPrice 관례상 만원 단위, excluUseArea는
// ㎡ 원본 그대로(공식 필드 excluUseAr = 전용면적) — pricePerM2 = 만원 / ㎡로 단위를
// 통일한다(§22 단위 오류 방지). 취소 거래(dealCanceled)는 집계에서 제외한다.
export function aggregateByAptSeq(trades: MolitTradeRaw[]): Map<string, MarketFeatureAggregate> {
  const byAptSeq = new Map<string, MolitTradeRaw[]>();
  for (const t of trades) {
    if (!t.aptSeq || t.dealCanceled || t.dealAmount <= 0) continue;
    const list = byAptSeq.get(t.aptSeq) ?? [];
    list.push(t);
    byAptSeq.set(t.aptSeq, list);
  }

  const result = new Map<string, MarketFeatureAggregate>();
  for (const [aptSeq, list] of byAptSeq) {
    const sortedByDate = [...list].sort((a, b) => a.dealDate.localeCompare(b.dealDate));
    const latest = sortedByDate[sortedByDate.length - 1];

    const pricePerM2Values = list
      .filter((t) => t.excluUseArea != null && t.excluUseArea > 0)
      .map((t) => t.dealAmount / (t.excluUseArea as number));

    result.set(aptSeq, {
      aptSeq,
      latestTradePrice: latest.dealAmount,
      latestTradeDate: latest.dealDate,
      medianPricePerM2_12m: pricePerM2Values.length > 0 ? median(pricePerM2Values) : null,
      transactionCount12m: list.length,
    });
  }
  return result;
}
