import { NextResponse } from 'next/server';
import { formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, isValidTrade, fetchMonthsThrottled, fetchMonthsThrottledWithStatus, MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido } from '@/lib/region-utils';
import { buildGapCandidates, normalizeAptName } from '@/lib/gap-invest-calc';
import { prisma } from '@/lib/prisma';
import { resolveTrustworthyPyeongBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';

// FIX_STATISTICS_DATA_TRUST — item.info === "면적m² • 층 • YYYY-MM-DD"에서
// raw 전용면적(㎡)만 파싱한다. 예전에는 `Math.round(areaNum / 3.3058)`로 가짜
// 평형을 만들어 화면 표시(hotIssues/gapInvest)와 "평당가" 랭킹(topPrices) 양쪽에
// 썼다 — AGENTS.md Unit Master 보호 원칙 위반. 이제 표시용 평형은 Unit Master
// batch 조회로만 채우고(resolveTrustworthyPyeongBatch), 평당가 랭킹도 Unit
// Master 신뢰 가능한 값이 있는 거래만 집계한다(가짜 평형으로 억지로 채우지
// 않음 — 표본이 줄어들 수 있지만 정직한 값만 보여준다).
const parseAreaM2 = (item: any): number | null => {
  const area = (item.info || '').split('•')[0]?.trim() || '';
  const areaNum = parseFloat(area);
  return areaNum || null;
};
const toPyeongLookupKey = (t: any): PyeongLookupKey => ({ name: t.name, dong: t.dong || '', aptSeq: t.aptSeq ?? null, rawAreaM2: parseAreaM2(t) as number });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lawdCdParam = searchParams.get('lawdCd');
  const sidoCodeParam = searchParams.get('sidoCode');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  // STATISTICS REGION FILTER V2 — lawdCd 없이 sidoCode만 오면 "시도 전체".
  const isSidoAll = !lawdCdParam && !!sidoCodeParam && /^\d{2}$/.test(sidoCodeParam);

  try {
    let lawdCd: string | null = null;
    if (!isSidoAll) {
      lawdCd = lawdCdParam && /^\d{5}$/.test(lawdCdParam) ? lawdCdParam : await resolveLawdCd(sido, gungu);
      if (!lawdCd) {
        return NextResponse.json({ success: false, error: `"${sido} ${gungu}" 지역 코드를 찾을 수 없습니다.` });
      }
    }

    const cacheKey = isSidoAll ? `stats-dashboard-sido:${sidoCodeParam}` : `stats-dashboard:${lawdCd}`;
    const data = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
      const now = new Date();

      // ── 1) 최근 12개월 매매/전세: 그래프 + 핫이슈 + 갭투자 + 전세가율에 재사용 ──
      const last12Months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
      });

      let aptMonthly: any[][];
      let rentMonthly: any[][];
      let partial = false;
      let failedLawdCds: string[] = [];

      if (isSidoAll) {
        // §19/§20 성능 — 부산 16개 구 × 12개월 × 2타입 = 384 task. 기존
        // rankings sido-all과 동일한 공유 스로틀을 그대로 쓴다(새 동시성 풀 없음).
        const districts = await getSigunguListForSido(sidoCodeParam!);
        const lawdCds = districts.map((d) => d.code.substring(0, 5));
        const tasks: MonthTask[] = [];
        for (const dLawdCd of lawdCds) {
          for (const ym of last12Months) {
            tasks.push({ key: `${dLawdCd}|apt:${ym}`, lawdCd: dLawdCd, dealYmd: ym, type: 'apt' });
            tasks.push({ key: `${dLawdCd}|rent:${ym}`, lawdCd: dLawdCd, dealYmd: ym, type: 'rent' });
          }
        }
        const results = await fetchMonthsThrottledWithStatus(tasks);
        const failedSet = new Set<string>();
        for (const dLawdCd of lawdCds) {
          for (const ym of last12Months) {
            if (results[`${dLawdCd}|apt:${ym}`]?.failed || results[`${dLawdCd}|rent:${ym}`]?.failed) failedSet.add(dLawdCd);
          }
        }
        failedLawdCds = Array.from(failedSet);
        partial = failedLawdCds.length > 0;
        // 시도 전체 집계는 구별로 트레이드를 합치기 때문에, 합치기 전 원본
        // lawdCd를 각 거래에 태그해 둔다 — GapInvestView/hotIssues 등이 단지
        // 상세로 이동할 때 어느 구 소속인지 몰라 잘못된 단지로 연결되는 것을
        // 막기 위함(§25 canonical route 요구사항).
        aptMonthly = last12Months.map((ym) => lawdCds.flatMap((d) => (results[`${d}|apt:${ym}`]?.items || []).map((t: any) => ({ ...t, lawdCd: d }))));
        rentMonthly = last12Months.map((ym) => lawdCds.flatMap((d) => (results[`${d}|rent:${ym}`]?.items || []).map((t: any) => ({ ...t, lawdCd: d }))));
      } else {
        const rollingTasks: MonthTask[] = [
          ...last12Months.map((dealYmd) => ({ key: `apt-roll-${dealYmd}`, lawdCd: lawdCd!, dealYmd, type: 'apt' as const })),
          ...last12Months.map((dealYmd) => ({ key: `rent-roll-${dealYmd}`, lawdCd: lawdCd!, dealYmd, type: 'rent' as const })),
        ];
        const taskResults = await fetchMonthsThrottled(rollingTasks);
        aptMonthly = last12Months.map((dealYmd) => (taskResults[`apt-roll-${dealYmd}`] || []).map((t: any) => ({ ...t, lawdCd: lawdCd })));
        rentMonthly = last12Months.map((dealYmd) => (taskResults[`rent-roll-${dealYmd}`] || []).map((t: any) => ({ ...t, lawdCd: lawdCd })));
      }

      const allAptTrades = aptMonthly.flat().filter(isValidTrade);
      const allRentTrades = rentMonthly.flat().filter(isValidTrade);
      const recentAptTrades = aptMonthly.slice(-3).flat().filter(isValidTrade);
      const recentRentTrades = rentMonthly.slice(-3).flat().filter(isValidTrade);

      // ── 2) 월별 그래프 데이터: 거래유형(매매/전세/월세)별 거래량(막대) + 가격지수(꺾은선,
      // 최초 유효월=100 기준). 세 유형 모두 한 번에 계산해둬서 클라이언트가 칩을 눌러
      // 유형을 바꿀 때마다 새로 API를 부를 필요가 없게 한다(월별 원본 거래는 이미 위에서
      // apt/rent 둘 다 12개월치를 받아둔 상태 — rent는 monthlyRent 유무로 전세/월세를
      // 구분한다: 0(또는 없음)이면 전세, 있으면 월세).
      const buildChartData = (dealType: 'sale' | 'jeonse' | 'wolse') => {
        const monthlyAgg = last12Months.map((ym, i) => {
          const aptTrades = aptMonthly[i].filter(isValidTrade);
          const rentTrades = rentMonthly[i].filter(isValidTrade);
          const selected =
            dealType === 'sale'
              ? aptTrades
              : dealType === 'jeonse'
                ? rentTrades.filter((t: any) => !t.monthlyRent || t.monthlyRent === 0)
                : rentTrades.filter((t: any) => t.monthlyRent && t.monthlyRent > 0);
          const avg = selected.length ? selected.reduce((s: number, t: any) => s + t.dealAmount, 0) / selected.length : null;
          return { month: `${ym.substring(2, 4)}.${ym.substring(4, 6)}`, volume: selected.length, avg };
        });
        const base = monthlyAgg.find((d) => d.avg)?.avg || null;
        return monthlyAgg.map((d) => ({
          month: d.month,
          volume: d.volume,
          priceIndex: base && d.avg ? Math.round((d.avg / base) * 1000) / 10 : null,
        }));
      };
      const chartDataByType = {
        sale: buildChartData('sale'),
        jeonse: buildChartData('jeonse'),
        wolse: buildChartData('wolse'),
      };
      const chartData = chartDataByType.sale; // 하위 호환: 기존 소비처(AI 검색 등)는 이 필드만 읽음

      // FIX_STATISTICS_DATA_TRUST — hotIssues(표시용)와 topPrices(평당가 집계,
      // 분모 자체에 평형이 들어감) 양쪽 다 Unit Master 조회가 끝나야 값을 채울
      // 수 있어, 필요한 lookup key를 먼저 전부 모아 batch 조회 한 번으로
      // 끝낸다(거래 개수만큼 DB 조회 안 함 — 쿼리 2회 고정).
      const pyeongLookupKeys = new Map<string, PyeongLookupKey>();
      allAptTrades.forEach((t: any) => {
        const key = toPyeongLookupKey(t);
        if (key.rawAreaM2 != null) pyeongLookupKeys.set(pyeongLookupKeyId(key), key);
      });
      const pyeongMap = await resolveTrustworthyPyeongBatch(prisma, Array.from(pyeongLookupKeys.values()));
      const lookupPyeong = (t: any): number | null => {
        const key = toPyeongLookupKey(t);
        if (key.rawAreaM2 == null) return null;
        return pyeongMap.get(pyeongLookupKeyId(key)) ?? null;
      };

      // ── 3) 핫이슈 거래: 최근 3개월 중 최고가 개별 거래 Top 5 ──
      const hotIssues = [...recentAptTrades]
        .sort((a: any, b: any) => b.dealAmount - a.dealAmount)
        .slice(0, 5)
        .map((t: any, i: number) => ({
          rank: i + 1,
          name: t.name,
          dong: t.dong || '',
          lawdCd: t.lawdCd,
          pyung: lookupPyeong(t),
          exclusiveAreaM2: parseAreaM2(t),
          price: t.price,
          dealCount: allAptTrades.filter((x: any) => normalizeAptName(x.name) === normalizeAptName(t.name)).length,
        }));

      // ── 4) 단지 랭킹: 최근 1년 평당가 평균 Top 5 — Unit Master 신뢰 가능한
      // 평형이 있는 거래만 집계한다(가짜 평형으로 채우지 않음, 표본이 줄어들
      // 수 있음을 감수한다).
      const pyungAgg: Record<string, { name: string; sum: number; count: number }> = {};
      allAptTrades.forEach((t: any) => {
        const pyung = lookupPyeong(t);
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
      // [STATISTICS V2.1 correctness hotfix] 기존에는 단지명만으로 묶어 배열의 첫
      // 원소를 "최근 매매"/"최근 전세"로 썼다 — 부산 서구 3개월 표본 실측 결과
      // 133개 후보 중 68건(51%)이 서로 다른 전용면적의 매매/전세를 뺀 값이었다
      // (예: "엘지" 49.83㎡ 매매 vs 134.94㎡ 전세). pairing 로직을
      // src/lib/gap-invest-calc.ts로 분리해 단위 테스트로 검증했다 — (정규화된
      // 단지명, 정확한 excluUseArea) 조합만 짝짓고(AREA MODEL V1 원칙대로 근접값
      // 병합 없음), dealDate 기준 정렬로 진짜 최신 거래를 고르며, 취소(해제)된
      // 매매와 반전세/월세(monthlyRent>0)는 제외한다.
      const recentPureJeonseTrades = recentRentTrades.filter((t: any) => !t.monthlyRent || t.monthlyRent === 0);
      const gapCandidates = buildGapCandidates(recentAptTrades, recentPureJeonseTrades)
        .map((c) => ({
          name: c.name,
          dong: c.dong,
          lawdCd: c.lawdCd,
          // FIX_STATISTICS_DATA_TRUST — 이전에는 `exclusiveAreaM2 / 3.3058`로
          // 가짜 평형을 만들었다. 갭투자 후보의 aptSeq+name+dong+raw면적은 이미
          // 위에서 매매 거래 전체 기준으로 batch 조회해 둔 pyeongMap에 대부분
          // 포함돼 있어 재조회 없이 조회만 한다 — 없으면 null(raw ㎡만 표시).
          pyung: pyeongMap.get(pyeongLookupKeyId({ name: c.name, dong: c.dong, aptSeq: c.aptSeq, rawAreaM2: c.exclusiveAreaM2 })) ?? null,
          exclusiveAreaM2: c.exclusiveAreaM2,
          gap: c.gap,
          dealCount: c.latestSale.tradeCount,
        }))
        .filter((c) => c.gap >= 0);

      const gapInvest = gapCandidates
        .sort((a, b) => a.gap - b.gap)
        .slice(0, 5)
        .map((c, i) => ({
          rank: i + 1,
          name: c.name,
          dong: c.dong,
          lawdCd: c.lawdCd,
          pyung: c.pyung,
          gap: formatKoreanPrice(c.gap),
          dealCount: c.dealCount,
        }));

      // ── 6) 전세가율: 매매+전세가 모두 있는 단지들의 (전세/매매) 평균 비율 ──
      // 지역 전체 평균 비율 계산은 이번 STEP의 감사 대상이 아니다 — 기존과 동일
      // 하게 단지명 단위(면적 무관)로만 그룹핑해 그대로 둔다.
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
        chartDataByType,
        hotIssues,
        gapInvest,
        topPrices,
        jeonseRate,
        currentMonthTrades,
        complexTrades,
        volumeRanking,
        volumeByPeriod,
        sidoAll: isSidoAll,
        sidoCode: sidoCodeParam,
        lawdCd,
        partial,
        failedDistricts: failedLawdCds,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Failed to fetch dashboard molit data:', err);
    return NextResponse.json({ success: false, error: 'API Error' });
  }
}
