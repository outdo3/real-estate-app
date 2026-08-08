import { NextResponse } from 'next/server';
import { fetchMolitData, formatKoreanPrice } from '@/lib/api-molit';

const REGCODE_PROXY = 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes';

// 지역코드 캐시: 같은 시/군/구 조합에 대한 반복 조회를 줄인다 (서버 인스턴스 생존 기간 동안 재사용)
const lawdCdCache = new Map<string, string | null>();

// 시/도 + 시/군/구 이름을 카카오맵 검색 모달(page.tsx)과 동일한 방식으로
// 공공 법정동코드 프록시에서 조회해 5자리 lawdCd로 변환한다.
async function resolveLawdCd(sido: string, gungu: string): Promise<string | null> {
  const cacheKey = `${sido}|${gungu}`;
  if (lawdCdCache.has(cacheKey)) return lawdCdCache.get(cacheKey)!;

  try {
    const sidoRes = await fetch(`${REGCODE_PROXY}?regcode_pattern=*00000000`);
    const sidoData = await sidoRes.json();
    const sidoEntry = (sidoData.regcodes || []).find((r: any) => r.name === sido);
    if (!sidoEntry) {
      lawdCdCache.set(cacheKey, null);
      return null;
    }
    const sidoCode = sidoEntry.code.substring(0, 2);

    const sigunguRes = await fetch(`${REGCODE_PROXY}?regcode_pattern=${sidoCode}*00000&is_ignore_zero=true`);
    const sigunguData = await sigunguRes.json();
    const candidates = (sigunguData.regcodes || []).filter((r: any) => r.code.substring(0, 5) !== `${sidoCode}000`);

    // 완전 일치만 허용한다. 예전에는 일치하는 항목이 없을 때 이름에 구 이름이
    // "포함"되는 첫 항목으로 대체했는데("강서구".includes("서구") === true),
    // 이 때문에 "서구"를 선택해도 "강서구"가 매칭될 위험이 있었다.
    // 정확히 일치하는 지역이 없으면 절대 추측하지 않고 null을 반환한다.
    const matched = candidates.find((r: any) => r.name === `${sido} ${gungu}`);

    const lawdCd = matched ? matched.code.substring(0, 5) : null;
    lawdCdCache.set(cacheKey, lawdCd);
    return lawdCd;
  } catch (e) {
    console.error('Failed to resolve lawdCd:', e);
    lawdCdCache.set(cacheKey, null);
    return null;
  }
}

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

const isValidTrade = (item: any) => item && item.typeLabel !== '에러' && item.dealAmount > 0;

// 공공데이터포털 MOLIT API는 "초당 서비스 요청제한 횟수 초과" 에러를 반환하는 엄격한
// 초당 호출 제한이 걸려 있다(실측 확인됨). fetchMolitData 자체는 실패해도 throw하지 않고
// typeLabel:'에러' 플레이스홀더를 반환하므로, 이를 "그 달 실거래 0건"과 구분하지 못하면
// 스로틀링으로 인한 실패가 마치 진짜 0건인 것처럼 표에 표시된다. 실패 시 짧은 대기 후
// 1회 재시도한다.
async function fetchMonthWithRetry(lawdCd: string, dealYmd: string, type: 'apt' | 'rent'): Promise<any[]> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const result = await fetchMolitData({ type, lawdCd, dealYmd });
      const failed = result.length === 1 && result[0]?.typeLabel === '에러';
      if (!failed) return result;
    } catch (e) {
      // fetchMolitData가 예외적으로 throw하는 경우에도 재시도 대상으로 취급
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return [];
}

interface MonthTask {
  key: string;
  lawdCd: string;
  dealYmd: string;
  type: 'apt' | 'rent';
}

// 대시보드 하나를 그리는 데 필요한 모든 월별 조회(최근 12개월 롤링 + 연도별 표)를
// 하나의 공용 큐로 모아 동시성을 낮게 고정한 워커 풀로 순차 처리한다. 연도별로 따로
// 배치를 나누면 각 배치 내부에서 여전히 수십 건이 한꺼번에 나가 초당 제한에 걸리므로,
// 전체를 하나의 큐로 합쳐야 실제 동시 요청 수를 안정적으로 제한할 수 있다.
async function fetchMonthsThrottled(tasks: MonthTask[], concurrency = 3): Promise<Record<string, any[]>> {
  const results: Record<string, any[]> = {};
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      results[task.key] = await fetchMonthWithRetry(task.lawdCd, task.dealYmd, task.type);
      // 초당 요청 수를 낮게 유지하기 위한 페이싱
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lawdCdParam = searchParams.get('lawdCd');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';

  try {
    // lawdCd가 직접 전달되면(전역 지역 선택 모달이 이미 정확히 해석해 둔 값) 이름
    // 기반 재해석을 아예 건너뛴다 — 문자열 매칭 단계 자체를 없애 "서구 선택 시
    // 강서구가 섞이는" 것과 같은 부류의 버그가 애초에 발생할 여지를 제거한다.
    // lawdCd가 없는 요청(레거시/직접 호출)에 한해서만 이름 기반 조회로 대체한다.
    const lawdCd = lawdCdParam && /^\d{5}$/.test(lawdCdParam) ? lawdCdParam : await resolveLawdCd(sido, gungu);
    if (!lawdCd) {
      // 지역 코드를 정확히 찾지 못했을 때 임의의 지역(예: 부산 서구)으로
      // 대체하면, 사용자가 선택한 지역과 다른 지역의 데이터가 표시되어
      // 마치 지역이 섞인 것처럼 보일 수 있다. 절대 추측하지 않고 명확히 실패를 알린다.
      return NextResponse.json({ success: false, error: `"${sido} ${gungu}" 지역 코드를 찾을 수 없습니다.` });
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIndex = now.getMonth(); // 0-indexed

    // ── 1) 필요한 모든 월별 조회를 하나의 태스크 목록으로 구성 ──
    // (a) 최근 12개월 매매/전세: 그래프 + 핫이슈 + 갭투자 + 전세가율에 재사용
    const last12Months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const rollingTasks: MonthTask[] = [
      ...last12Months.map((dealYmd) => ({ key: `apt-roll-${dealYmd}`, lawdCd, dealYmd, type: 'apt' as const })),
      ...last12Months.map((dealYmd) => ({ key: `rent-roll-${dealYmd}`, lawdCd, dealYmd, type: 'rent' as const })),
    ];

    // (b) 연도별(2014~올해) 통계표용 월별 매매 데이터
    const startYear = 2014;
    const years = Array.from({ length: Math.max(currentYear - startYear + 1, 0) }, (_, i) => startYear + i);
    const yearlyTasks: MonthTask[] = [];
    years.forEach((year) => {
      const monthCount = year === currentYear ? currentMonthIndex + 1 : 12;
      for (let m = 1; m <= monthCount; m++) {
        const dealYmd = `${year}${String(m).padStart(2, '0')}`;
        yearlyTasks.push({ key: `year-${dealYmd}`, lawdCd, dealYmd, type: 'apt' });
      }
    });

    const taskResults = await fetchMonthsThrottled([...rollingTasks, ...yearlyTasks]);

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

    // ── 3) 연도별(2014~올해) 통계표: 거래년도, 최고가, 최저가, 평균가, 거래량 ──
    // 위에서 이미 스로틀링된 큐로 조회해 둔 taskResults를 연도별로 다시 묶기만 한다.
    const yearlyTable = years.map((year) => {
      const monthCount = year === currentYear ? currentMonthIndex + 1 : 12;
      const monthly = Array.from({ length: monthCount }, (_, i) => {
        const dealYmd = `${year}${String(i + 1).padStart(2, '0')}`;
        return taskResults[`year-${dealYmd}`] || [];
      });
      const trades = monthly.flat().filter(isValidTrade);
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

    // ── 4) 핫이슈 거래: 최근 3개월 중 최고가 개별 거래 Top 5 ──
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

    // ── 5) 단지 랭킹: 최근 1년 평당가 평균 Top 5 ──
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

    // ── 6) 갭투자: 최근 3개월 내 매매+전세가 모두 존재하는 단지의 (매매가-전세보증금) Top 5 ──
    // 정확한 동일 평형 매칭 대신, 단지별 최신 매매/전세 거래 1건씩을 사용한 근사치임을 명시한다.
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
        return { name: latestApt.name, pyung: parsePyung(latestApt), gap, dealCount: apts.length };
      })
      .filter((c) => c.gap >= 0);

    const gapInvest = gapCandidates
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 5)
      .map((c, i) => ({
        rank: i + 1,
        name: c.name,
        pyung: c.pyung,
        gap: formatKoreanPrice(c.gap),
        dealCount: c.dealCount,
      }));

    // ── 7) 전세가율: 매매+전세가 모두 있는 단지들의 (전세/매매) 평균 비율 ──
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

    // ── 8) 클릭 시 팝업으로 보여줄 실거래 내역 ──
    const tradeDetail = (t: any) => ({
      name: t.name,
      price: t.price,
      tradeDate: (t.info || '').split('•').pop()?.trim() || '',
      dong: t.dong || '',
    });

    // (a) 이번 달 거래량 카드 클릭 시: 이번 달 전체 거래 내역
    const currentMonthTrades = (aptMonthly[11] || [])
      .filter(isValidTrade)
      .map(tradeDetail)
      .sort((a: any, b: any) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());

    // (b) 랭킹 리스트(핫이슈/평당가/갭투자) 항목 클릭 시: 해당 단지의 최근 1년 거래 내역
    // 전체 단지의 1년치를 다 보내면 응답이 과도하게 커지므로, 실제로 화면에 노출되는
    // 단지에 한해서만 모아서 내려준다.
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

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          volume,
          volumeChange: volume - prevVolume,
          chonseRate: jeonseRate,
        },
        chartData,
        yearlyTable,
        hotIssues,
        gapInvest,
        topPrices,
        jeonseRate,
        currentMonthTrades,
        complexTrades,
      },
    });
  } catch (err) {
    console.error('Failed to fetch dashboard molit data:', err);
    return NextResponse.json({ success: false, error: 'API Error' });
  }
}
