import { NextResponse } from 'next/server';
import { formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, isValidTrade, fetchMonthsThrottled, MonthTask } from '@/lib/molit-stats-helpers';
import { getYearlySaleAggregate } from '@/lib/trade-history-read';

interface YearlyRow {
  year: number;
  count: number;
  maxPrice: string | null;
  minPrice: string | null;
  avgPrice: string | null;
}

// TRADE_DB_FIRST_V1 STEP B — 거래량(연도별 표, VolumeChartCard "표" 뷰)의
// 매매(sale) 부분만 부산 요청에 한해 DB-first로 전환한다. 전세/월세는
// TradeHistory DB에 아예 없어(dealType='sale'만 V1 범위, TRADE_HISTORY_DATA_V1)
// 기존 MOLIT 경로를 그대로 유지한다 — "DB에 없으면 MOLIT 호출"이 아니라, 원천적으로
// 데이터가 없는 dealType은 애초에 이 함수를 타지 않는 고정 라우팅이다(price-rankings
// area84 전환과 동일 원칙). raw row를 Node로 끌어와 reduce하지 않고
// getYearlySaleAggregate(DB-side GROUP BY year)를 쓴다 — 실측(해운대구 13년,
// 69,025 row): raw fetch 12.9초 → DB aggregate로 교체.
const BUSAN_SIDO_CODE = '26';

async function fetchYearlySaleTableFromDb(lawdCd: string, startYear: number, currentYear: number): Promise<YearlyRow[]> {
  const aggregates = await getYearlySaleAggregate(lawdCd, startYear);
  const byYear = new Map(aggregates.map((a) => [a.year, a]));
  const years = Array.from({ length: Math.max(currentYear - startYear + 1, 0) }, (_, i) => startYear + i);
  return years.map((year) => {
    const agg = byYear.get(year);
    if (!agg || agg.count === 0) return { year, count: 0, maxPrice: null, minPrice: null, avgPrice: null };
    return {
      year,
      count: agg.count,
      maxPrice: formatKoreanPrice(String(agg.maxAmount)),
      minPrice: formatKoreanPrice(String(agg.minAmount)),
      avgPrice: formatKoreanPrice(String(agg.avgAmount)),
    };
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lawdCdParam = searchParams.get('lawdCd');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';

  try {
    const lawdCd = lawdCdParam && /^\d{5}$/.test(lawdCdParam) ? lawdCdParam : await resolveLawdCd(sido, gungu);
    if (!lawdCd) {
      return NextResponse.json({ success: false, error: `"${sido} ${gungu}" 지역 코드를 찾을 수 없습니다.` });
    }

    const isBusan = lawdCd.startsWith(BUSAN_SIDO_CODE);

    const yearlyTableByType = await getOrSetCache(`stats-yearly:${lawdCd}:${isBusan ? 'db' : 'live'}`, 10 * 60 * 1000, async () => {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthIndex = now.getMonth();
      const startYear = 2014;
      const years = Array.from({ length: Math.max(currentYear - startYear + 1, 0) }, (_, i) => startYear + i);

      // 거래유형(매매/전세/월세) 칩을 눌렀을 때 새로 API를 부르지 않도록, 필요한 유형
      // 전부를 연도 전체 범위로 한 번에 받아 하나의 캐시 항목 안에서 계산해둔다.
      // 부산 요청은 sale(매매)을 DB에서 가져오므로 year-apt-* MOLIT task 자체를
      // 만들지 않는다(호출 수 절반 절감) — jeonse/wolse는 TradeHistory DB에 없어
      // (dealType='sale'만 V1 범위) 부산이어도 여전히 rent MOLIT fetch가 필요하다.
      const yearlyTasks: MonthTask[] = [];
      years.forEach((year) => {
        const monthCount = year === currentYear ? currentMonthIndex + 1 : 12;
        for (let m = 1; m <= monthCount; m++) {
          const dealYmd = `${year}${String(m).padStart(2, '0')}`;
          if (!isBusan) yearlyTasks.push({ key: `year-apt-${dealYmd}`, lawdCd, dealYmd, type: 'apt' });
          yearlyTasks.push({ key: `year-rent-${dealYmd}`, lawdCd, dealYmd, type: 'rent' });
        }
      });

      const [taskResults, saleTableFromDb] = await Promise.all([
        fetchMonthsThrottled(yearlyTasks),
        isBusan ? fetchYearlySaleTableFromDb(lawdCd, startYear, currentYear) : Promise.resolve(null),
      ]);

      const buildTable = (dealType: 'sale' | 'jeonse' | 'wolse') =>
        years.map((year) => {
          const monthCount = year === currentYear ? currentMonthIndex + 1 : 12;
          const monthlyTrades = Array.from({ length: monthCount }, (_, i) => {
            const dealYmd = `${year}${String(i + 1).padStart(2, '0')}`;
            const key = dealType === 'sale' ? `year-apt-${dealYmd}` : `year-rent-${dealYmd}`;
            return taskResults[key] || [];
          })
            .flat()
            .filter(isValidTrade);

          const trades =
            dealType === 'sale'
              ? monthlyTrades
              : dealType === 'jeonse'
                ? monthlyTrades.filter((t: any) => !t.monthlyRent || t.monthlyRent === 0)
                : monthlyTrades.filter((t: any) => t.monthlyRent && t.monthlyRent > 0);

          if (trades.length === 0) {
            return { year, count: 0, maxPrice: null, minPrice: null, avgPrice: null };
          }
          const amounts = trades.map((t: any) => t.dealAmount);
          const maxPrice = Math.max(...amounts);
          const minPrice = Math.min(...amounts);
          const avgPrice = Math.round(amounts.reduce((a: number, b: number) => a + b, 0) / amounts.length);
          return {
            year,
            count: trades.length,
            maxPrice: formatKoreanPrice(maxPrice),
            minPrice: formatKoreanPrice(minPrice),
            avgPrice: formatKoreanPrice(avgPrice),
          };
        });

      return {
        sale: saleTableFromDb ?? buildTable('sale'),
        jeonse: buildTable('jeonse'),
        wolse: buildTable('wolse'),
      };
    });

    return NextResponse.json({
      success: true,
      data: { yearlyTable: yearlyTableByType.sale, yearlyTableByType },
    });
  } catch (err) {
    console.error('Failed to fetch yearly molit data:', err);
    return NextResponse.json({ success: false, error: 'API Error' });
  }
}
