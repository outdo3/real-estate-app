import { NextResponse } from 'next/server';
import { formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, isValidTrade, fetchMonthsThrottled, MonthTask } from '@/lib/molit-stats-helpers';

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

    const yearlyTableByType = await getOrSetCache(`stats-yearly:${lawdCd}`, 10 * 60 * 1000, async () => {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthIndex = now.getMonth();
      const startYear = 2014;
      const years = Array.from({ length: Math.max(currentYear - startYear + 1, 0) }, (_, i) => startYear + i);

      // 거래유형(매매/전세/월세) 칩을 눌렀을 때 새로 API를 부르지 않도록, apt/rent 둘 다
      // 연도 전체 범위로 한 번에 받아 하나의 캐시 항목 안에 세 유형 표를 모두 계산해둔다.
      const yearlyTasks: MonthTask[] = [];
      years.forEach((year) => {
        const monthCount = year === currentYear ? currentMonthIndex + 1 : 12;
        for (let m = 1; m <= monthCount; m++) {
          const dealYmd = `${year}${String(m).padStart(2, '0')}`;
          yearlyTasks.push({ key: `year-apt-${dealYmd}`, lawdCd, dealYmd, type: 'apt' });
          yearlyTasks.push({ key: `year-rent-${dealYmd}`, lawdCd, dealYmd, type: 'rent' });
        }
      });

      const taskResults = await fetchMonthsThrottled(yearlyTasks);

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
        sale: buildTable('sale'),
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
