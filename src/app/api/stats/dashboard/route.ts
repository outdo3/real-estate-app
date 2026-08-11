import { NextResponse } from 'next/server';
import { formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, isValidTrade, fetchMonthsThrottled, MonthTask } from '@/lib/molit-stats-helpers';

const normalizeAptName = (name: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

// item.info === "면적m² • 층 • YYYY-MM-DD" 문자열에서 평형을 파싱
const parsePyung = (item: any): number | null => {
  const area = (item.info || '').split('•')[0]?.trim() || '';
  const areaNum = parseFloat(area);
  return areaNum ? Math.round(areaNum / 3.3058) : null;
};

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

    const data = await getOrSetCache(`stats-dashboard:${lawdCd}`, 5 * 60 * 1000, async () => {
      const now = new Date();

      // ── 1) 최근 12개월 매매/전세: 그래프 + 핫이슈 + 갭투자 + 전세가율에 재사용 ──
      const last12Months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
      });
      const rollingTasks: MonthTask[] = [
        ...last12Months.map((dealYmd) => ({ key: `apt-roll-${dealYmd}`, lawdCd, dealYmd, type: 'apt' as const })),
        ...last12Months.map((dealYmd) => ({ key: `rent-roll-${dealYmd}`, lawdCd, dealYmd, type: 'rent' as const })),
      ];

      const taskResults = await fetchMonthsThrottled(rollingTasks);

      const aptMonthly = last12Months.map((dealYmd) => taskResults[`apt-roll-${dealYmd}`] || []);
      const rentMonthly = last12Months.map((dealYmd) => taskResults[`rent-roll-${dealYmd}`] || []);

      const allAptTrades = aptMonthly.flat().filter(isValidTrade);
      const allRentTrades = rentMonthly.flat().filter(isValidTrade);
      const recentAptTrades = aptMonthly.slice(-3).flat().filter(isValidTrade);
      const recentRentTrades = rentMonthly.slice(-3).flat().filter(isValidTrade);

      // ── 2) 월별 그래프 데이터: 거래량(막대) + 매매/전세 가격지수(꺾은선, 최초 유효월=100 기준) ──
      const monthlyAgg = last12Months.map((ym, i) => {
        const aptTrades = aptMonthly[i].filter(isValidTrade);
        const rentTrades = rentMonthly[i].filter(isValidTrade);
        const avgApt = aptTrades.length ? aptTrades.reduce((s: number, t: any) => s + t.dealAmount, 0) / aptTrades.length : null;
        const avgRent = rentTrades.length ? rentTrades.reduce((s: number, t: any) => s + t.dealAmount, 0) / rentTrades.length : null;
        return { month: `${ym.substring(2, 4)}.${ym.substring(4, 6)}`, volume: aptTrades.length, avgApt, avgRent };
      });
      const baseApt = monthlyAgg.find((d) => d.avgApt)?.avgApt || null;
      const baseRent = monthlyAgg.find((d) => d.avgRent)?.avgRent || null;
      const chartData = monthlyAgg.map((d) => ({
        month: d.month,
        volume: d.volume,
        saleIndex: baseApt && d.avgApt ? Math.round((d.avgApt / baseApt) * 1000) / 10 : null,
        jeonseIndex: baseRent && d.avgRent ? Math.round((d.avgRent / baseRent) * 1000) / 10 : null,
      }));

      // ── 3) 핫이슈 거래: 최근 3개월 중 최고가 개별 거래 Top 5 ──
      const hotIssues = [...recentAptTrades]
        .sort((a: any, b: any) => b.dealAmount - a.dealAmount)
        .slice(0, 5)
        .map((t: any, i: number) => ({
          rank: i + 1,
          name: t.name,
          pyung: parsePyung(t),
          price: t.price,
          dealCount: allAptTrades.filter((x: any) => normalizeAptName(x.name) === normalizeAptName(t.name)).length,
        }));

      // ── 4) 단지 랭킹: 최근 1년 평당가 평균 Top 5 ──
      const pyungAgg: Record<string, { name: string; sum: number; count: number }> = {};
      allAptTrades.forEach((t: any) => {
        const pyung = parsePyung(t);
        if (!pyung || pyung <= 0) return;
        const key = normalizeAptName(t.name);
        const pricePerPyung = t.dealAmount / pyung;
        if (!pyungAgg[key]) pyungAgg[key] = { name: t.name, sum: 0, count: 0 };
        pyungAgg[key].sum += pricePerPyung;
        pyungAgg[key].count += 1;
      });
      const topPrices = Object.values(pyungAgg)
        .map((c) => ({ name: c.name, avgPricePerPyung: c.sum / c.count, dealCount: c.count }))
        .sort((a, b) => b.avgPricePerPyung - a.avgPricePerPyung)
        .slice(0, 5)
        .map((c, i) => ({
          rank: i + 1,
          name: c.name,
          pricePerPyung: `${Math.round(c.avgPricePerPyung).toLocaleString('ko-KR')}만/평`,
          dealCount: c.dealCount,
        }));

      // ── 5) 갭투자: 최근 3개월 내 매매+전세가 모두 존재하는 단지의 (매매가-전세보증금) Top 5 ──
      const aptByComplex: Record<string, any[]> = {};
      recentAptTrades.forEach((t: any) => {
        const key = normalizeAptName(t.name);
        (aptByComplex[key] ||= []).push(t);
      });
      const rentByComplex: Record<string, any[]> = {};
      recentRentTrades.forEach((t: any) => {
        const key = normalizeAptName(t.name);
        (rentByComplex[key] ||= []).push(t);
      });

      const gapCandidates = Object.keys(aptByComplex)
        .filter((key) => rentByComplex[key]?.length > 0)
        .map((key) => {
          const apts = aptByComplex[key];
          const rents = rentByComplex[key];
          const latestApt = apts[0];
          const latestRent = rents[0];
          const gap = latestApt.dealAmount - latestRent.dealAmount;
          return { name: latestApt.name, dong: latestApt.dong || '', pyung: parsePyung(latestApt), gap, dealCount: apts.length };
        })
        .filter((c) => c.gap >= 0);

      const gapInvest = gapCandidates
        .sort((a, b) => a.gap - b.gap)
        .slice(0, 5)
        .map((c, i) => ({
          rank: i + 1,
          name: c.name,
          dong: c.dong,
          pyung: c.pyung,
          gap: formatKoreanPrice(c.gap),
          dealCount: c.dealCount,
        }));

      // ── 6) 전세가율: 매매+전세가 모두 있는 단지들의 (전세/매매) 평균 비율 ──
      const jeonseRatios: number[] = [];
      Object.keys(aptByComplex).forEach((key) => {
        const rents = rentByComplex[key];
        if (!rents?.length) return;
        const apts = aptByComplex[key];
        const avgApt = apts.reduce((s: number, t: any) => s + t.dealAmount, 0) / apts.length;
        const avgRent = rents.reduce((s: number, t: any) => s + t.dealAmount, 0) / rents.length;
        if (avgApt > 0) jeonseRatios.push((avgRent / avgApt) * 100);
      });
      const jeonseRate = jeonseRatios.length
        ? Math.round((jeonseRatios.reduce((a, b) => a + b, 0) / jeonseRatios.length) * 10) / 10
        : null;

      const volume = aptMonthly[11]?.filter(isValidTrade).length || 0;
      const prevVolume = aptMonthly[10]?.filter(isValidTrade).length || 0;

      // ── AI 검색 거래량 카드의 기간 선택(1/3/6/12개월)용: 각 기간 창 안에서 단지별
      // 거래건수를 집계해 상위 단지 순위를 미리 계산해둔다. allAptTrades는 이미 12개월치를
      // 다 갖고 있으므로 클라이언트가 기간을 바꿀 때마다 새로 API를 부를 필요가 없다.
      const buildVolumeRanking = (monthsBack: number) => {
        const windowTrades = aptMonthly.slice(12 - monthsBack).flat().filter(isValidTrade);
        const byName: Record<string, { name: string; dong: string; count: number }> = {};
        windowTrades.forEach((t: any) => {
          const key = normalizeAptName(t.name);
          if (!byName[key]) byName[key] = { name: t.name, dong: t.dong || '', count: 0 };
          byName[key].count += 1;
        });
        return Object.values(byName)
          .sort((a, b) => b.count - a.count)
          .slice(0, 10)
          .map((c, i) => ({ rank: i + 1, name: c.name, dong: c.dong, dealCount: c.count }));
      };
      const volumeRanking = {
        '1': buildVolumeRanking(1),
        '3': buildVolumeRanking(3),
        '6': buildVolumeRanking(6),
        '12': buildVolumeRanking(12),
      };
      const volumeByPeriod = {
        '1': volume,
        '3': aptMonthly.slice(9).flat().filter(isValidTrade).length,
        '6': aptMonthly.slice(6).flat().filter(isValidTrade).length,
        '12': allAptTrades.length,
      };

      // ── 7) 클릭 시 팝업으로 보여줄 실거래 내역 ──
      const tradeDetail = (t: any) => ({
        name: t.name,
        price: t.price,
        tradeDate: (t.info || '').split('•').pop()?.trim() || '',
        dong: t.dong || '',
      });

      const currentMonthTrades = (aptMonthly[11] || [])
        .filter(isValidTrade)
        .map(tradeDetail)
        .sort((a: any, b: any) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());

      const clickableNames = new Set<string>([
        ...hotIssues.map((h) => normalizeAptName(h.name)),
        ...topPrices.map((h) => normalizeAptName(h.name)),
        ...gapInvest.map((h) => normalizeAptName(h.name)),
      ]);
      const complexTrades: Record<string, ReturnType<typeof tradeDetail>[]> = {};
      allAptTrades.forEach((t: any) => {
        const key = normalizeAptName(t.name);
        if (!clickableNames.has(key)) return;
        (complexTrades[key] ||= []).push(tradeDetail(t));
      });
      Object.values(complexTrades).forEach((list) =>
        list.sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime())
      );

      return {
        summary: {
          volume,
          volumeChange: volume - prevVolume,
          chonseRate: jeonseRate,
        },
        chartData,
        hotIssues,
        gapInvest,
        topPrices,
        jeonseRate,
        currentMonthTrades,
        complexTrades,
        volumeRanking,
        volumeByPeriod,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Failed to fetch dashboard molit data:', err);
    return NextResponse.json({ success: false, error: 'API Error' });
  }
}
