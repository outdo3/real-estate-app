import { NextResponse } from 'next/server';
import { formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, isValidTrade, fetchMonthsThrottled, MonthTask } from '@/lib/molit-stats-helpers';

const normalizeAptName = (name: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

const parsePyung = (item: any): number | null => {
  const area = (item.info || '').split('•')[0]?.trim() || '';
  const areaNum = parseFloat(area);
  return areaNum ? Math.round(areaNum / 3.3058) : null;
};

const parseTradeDate = (item: any): string => (item.info || '').split('•').pop()?.trim() || '';

// 단지 랭킹류(하락/상승/최고가/거래량/역전세) 4~5개 화면이 공유하는 단지별 집계 라우트.
// "시세 추이"는 최신 거래 1건 vs 가장 오래된 거래 1건만 비교하면 그중 하나가 이상치일 때
// 왜곡된다는 걸 apt-brief.ts에서 실측으로 확인했던 적이 있어(단일 저가 거래 하나 때문에
// 57% 상승으로 잘못 계산됐던 사례), 여기서도 처음부터 최근 N건과 가장 오래된 N건의 평균을
// 비교하는 동일한 방식을 쓴다.
const TREND_SAMPLE_SIZE = 3;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lawdCdParam = searchParams.get('lawdCd');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  const type = (searchParams.get('type') === 'rent' ? 'rent' : 'apt') as 'apt' | 'rent';
  const months = Math.min(24, Math.max(1, parseInt(searchParams.get('months') || '12', 10) || 12));

  try {
    const lawdCd = lawdCdParam && /^\d{5}$/.test(lawdCdParam) ? lawdCdParam : await resolveLawdCd(sido, gungu);
    if (!lawdCd) {
      return NextResponse.json({ success: false, error: `"${sido} ${gungu}" 지역 코드를 찾을 수 없습니다.` });
    }

    const data = await getOrSetCache(`stats-rankings:${type}:${lawdCd}:${months}`, 5 * 60 * 1000, async () => {
      const now = new Date();
      const monthList = Array.from({ length: months }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
      });
      const tasks: MonthTask[] = monthList.map((dealYmd) => ({ key: dealYmd, lawdCd, dealYmd, type }));
      const taskResults = await fetchMonthsThrottled(tasks);
      let allTrades = monthList.flatMap((ym) => taskResults[ym] || []).filter(isValidTrade);

      // rent(전월세) 타입은 순수 전세(보증금만, 월세 0)와 반전세/월세(보증금+매달 월세)가
      // 섞여 있다. dealAmount(보증금)만으로 추세를 비교하면, 실제 전세가가 안 떨어졌어도
      // "전세 → 반전세 전환"만으로 보증금이 뚝 떨어져 보여 역전세로 오인된다(실측: 반전세
      // 전환 거래 때문에 특정 단지가 -97%로 잡혔던 걸 확인). 순수 전세 거래만 남긴다.
      if (type === 'rent') {
        allTrades = allTrades.filter((t: any) => !t.monthlyRent || t.monthlyRent === 0);
      }

      // 단지(정규화된 이름)별로 묶고, 계약일 오름차순으로 정렬해 "최근 N건 평균 vs 가장
      // 오래된 N건 평균"을 계산한다.
      const byComplex: Record<string, { name: string; items: any[] }> = {};
      allTrades.forEach((t: any) => {
        const key = normalizeAptName(t.name);
        (byComplex[key] ||= { name: t.name, items: [] }).items.push(t);
      });

      const complexes = Object.values(byComplex).map(({ name, items }) => {
        const sorted = [...items].sort(
          (a, b) => new Date(parseTradeDate(a)).getTime() - new Date(parseTradeDate(b)).getTime()
        );
        const tradeCount = sorted.length;
        const latest = sorted[sorted.length - 1];
        const latestPyung = parsePyung(latest);

        const maxTrade = sorted.reduce((max, t) => (t.dealAmount > max.dealAmount ? t : max), sorted[0]);

        let pctChange: number | null = null;
        if (tradeCount >= 2) {
          const sampleSize = Math.min(TREND_SAMPLE_SIZE, Math.floor(tradeCount / 2)) || 1;
          const toUnitPrice = (t: any) => {
            const p = parsePyung(t);
            return p && p > 0 ? t.dealAmount / p : null;
          };
          const recent = sorted.slice(-sampleSize).map(toUnitPrice).filter((v): v is number => v !== null);
          const oldest = sorted.slice(0, sampleSize).map(toUnitPrice).filter((v): v is number => v !== null);
          if (recent.length > 0 && oldest.length > 0) {
            const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
            const recentAvg = avg(recent);
            const oldestAvg = avg(oldest);
            if (oldestAvg > 0) pctChange = Math.round(((recentAvg - oldestAvg) / oldestAvg) * 1000) / 10;
          }
        }

        return {
          name,
          dong: latest.dong || '',
          pyung: latestPyung,
          tradeCount,
          latestPrice: latest.price,
          latestDealAmount: latest.dealAmount,
          latestDate: parseTradeDate(latest),
          maxPrice: formatKoreanPrice(maxTrade.dealAmount),
          maxDealAmount: maxTrade.dealAmount,
          maxDate: parseTradeDate(maxTrade),
          pctChange,
        };
      });

      return { lawdCd, months, type, complexes };
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Failed to fetch stats rankings:', err);
    return NextResponse.json({ success: false, error: 'API Error' });
  }
}
