import { NextResponse } from 'next/server';
import { formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, isValidTrade, fetchMonthsThrottled, fetchMonthsThrottledWithStatus, MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido } from '@/lib/region-utils';
import { prisma } from '@/lib/prisma';
import { resolveTrustworthyPyeongBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';

const normalizeAptName = (name: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

// FIX_STATISTICS_DATA_TRUST — 예전에는 이름만으로 단지를 묶어(normalizeAptName만)
// 같은 이름의 다른 단지가 섞일 위험이 있었다(한 구 안에서도 가능하고, 시도 전체
// 집계에서는 훨씬 커진다 — "래미안"이 서구에도 해운대구에도 있을 수 있음).
// aptSeq(canonical identity)가 있으면 그것만 쓰고, 없을 때만 (동, 정규화된
// 이름)으로 좁혀서 묶는다 — gap-invest-calc.ts의 complexIdentityKey와 동일 원칙.
function complexIdentityKey(t: any): string {
  if (t.aptSeq) return `seq:${t.aptSeq}`;
  return `nd:${t.dong || ''}::${normalizeAptName(t.name)}`;
}

// FIX_STATISTICS_DATA_TRUST — 원본 raw 전용면적(㎡)만 파싱한다. 예전에는 여기서
// `Math.round(areaNum / 3.3058)`로 "평형"을 만들어 화면 표시와 평당가 계산 양쪽에
// 썼는데, AGENTS.md Unit Master 보호 원칙(exclusiveArea/3.3058을 대표 평형으로
// 표시 금지)에 위배된다. 화면 표시용 평형은 이제 Unit Master를 조회해서만
// 채우고(resolveTrustworthyPyeongBatch, 아래), 여기서는 raw ㎡만 반환한다.
const parseAreaM2 = (item: any): number | null => {
  const area = (item.info || '').split('•')[0]?.trim() || '';
  const areaNum = parseFloat(area);
  return areaNum || null;
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
  const sidoCodeParam = searchParams.get('sidoCode');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  const type = (searchParams.get('type') === 'rent' ? 'rent' : 'apt') as 'apt' | 'rent';
  const months = Math.min(24, Math.max(1, parseInt(searchParams.get('months') || '12', 10) || 12));
  // STATISTICS REGION FILTER V2 — lawdCd 없이 sidoCode(2자리)만 오면 "시도 전체".
  const isSidoAll = !lawdCdParam && !!sidoCodeParam && /^\d{2}$/.test(sidoCodeParam);

  try {
    let lawdCd: string | null = null;
    if (!isSidoAll) {
      lawdCd = lawdCdParam && /^\d{5}$/.test(lawdCdParam) ? lawdCdParam : await resolveLawdCd(sido, gungu);
      if (!lawdCd) {
        return NextResponse.json({ success: false, error: `"${sido} ${gungu}" 지역 코드를 찾을 수 없습니다.` });
      }
    }

    const cacheKey = isSidoAll ? `stats-rankings-sido:${type}:${sidoCodeParam}:${months}` : `stats-rankings:${type}:${lawdCd}:${months}`;
    const data = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
      const now = new Date();
      const monthList = Array.from({ length: months }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
      });

      let allTrades: any[] = [];
      let partial = false;
      let failedLawdCds: string[] = [];

      if (isSidoAll) {
        // §19/§20 성능 — 부산 16개 구 × 12개월 × 1타입도 이미 192개 task라
        // 여기서도 lookback을 늘리지 않고 요청받은 months만큼만 곱한다(기존
        // 단일 구 계약과 동일한 months 개념을 그대로 재사용 — 새 파라미터 없음).
        const districts = await getSigunguListForSido(sidoCodeParam!);
        const lawdCds = districts.map((d) => d.code.substring(0, 5));
        const tasks: MonthTask[] = [];
        for (const dLawdCd of lawdCds) {
          for (const ym of monthList) tasks.push({ key: `${dLawdCd}|${ym}`, lawdCd: dLawdCd, dealYmd: ym, type });
        }
        const results = await fetchMonthsThrottledWithStatus(tasks);
        const failedSet = new Set<string>();
        for (const dLawdCd of lawdCds) {
          for (const ym of monthList) if (results[`${dLawdCd}|${ym}`]?.failed) failedSet.add(dLawdCd);
        }
        failedLawdCds = Array.from(failedSet);
        partial = failedLawdCds.length > 0;
        // 시도 전체 집계는 구별 거래를 합치므로, 합치기 전에 원본 lawdCd를
        // 각 거래에 태그한다 — 단지 상세로 이동할 때 다른 구 단지로 잘못
        // 연결되지 않도록(§25 canonical route 요구사항).
        for (const dLawdCd of lawdCds) {
          for (const ym of monthList) {
            for (const raw of results[`${dLawdCd}|${ym}`]?.items || []) allTrades.push({ ...raw, lawdCd: dLawdCd });
          }
        }
        allTrades = allTrades.filter(isValidTrade);
      } else {
        const tasks: MonthTask[] = monthList.map((dealYmd) => ({ key: dealYmd, lawdCd: lawdCd!, dealYmd, type }));
        const taskResults = await fetchMonthsThrottled(tasks);
        allTrades = monthList.flatMap((ym) => (taskResults[ym] || []).map((raw: any) => ({ ...raw, lawdCd: lawdCd! }))).filter(isValidTrade);
      }

      // rent(전월세) 타입은 순수 전세(보증금만, 월세 0)와 반전세/월세(보증금+매달 월세)가
      // 섞여 있다. dealAmount(보증금)만으로 추세를 비교하면, 실제 전세가가 안 떨어졌어도
      // "전세 → 반전세 전환"만으로 보증금이 뚝 떨어져 보여 역전세로 오인된다(실측: 반전세
      // 전환 거래 때문에 특정 단지가 -97%로 잡혔던 걸 확인). 순수 전세 거래만 남긴다.
      if (type === 'rent') {
        allTrades = allTrades.filter((t: any) => !t.monthlyRent || t.monthlyRent === 0);
      }

      // 단지 identity로 묶고(§상단 complexIdentityKey), 계약일 오름차순으로 정렬해
      // "최근 N건 평균 vs 가장 오래된 N건 평균"을 계산한다.
      const byComplex: Record<string, { name: string; items: any[] }> = {};
      allTrades.forEach((t: any) => {
        const key = complexIdentityKey(t);
        (byComplex[key] ||= { name: t.name, items: [] }).items.push(t);
      });

      const complexes = Object.values(byComplex).map(({ name, items }) => {
        const sorted = [...items].sort(
          (a, b) => new Date(parseTradeDate(a)).getTime() - new Date(parseTradeDate(b)).getTime()
        );
        const tradeCount = sorted.length;
        const latest = sorted[sorted.length - 1];

        const maxTrade = sorted.reduce((max, t) => (t.dealAmount > max.dealAmount ? t : max), sorted[0]);

        // FIX_STATISTICS_DATA_TRUST — 추세(pctChange)는 항상 "최근 N건 평균 단가
        // vs 오래된 N건 평균 단가"의 비율이다. 단가의 분모를 평형(가짜 계산)에서
        // raw ㎡로 바꿔도 비율 자체는 수학적으로 동일하다(모든 항에 같은 상수
        // 1/3.3058이 곱해질 뿐 — 비율에서 상쇄됨). 오히려 반올림된 평형으로
        // 묶이던 것보다 raw ㎡ 비교가 더 정밀하다(84.7855와 84.9950이 같은
        // "34평"으로 뭉개지지 않음).
        let pctChange: number | null = null;
        if (tradeCount >= 2) {
          const sampleSize = Math.min(TREND_SAMPLE_SIZE, Math.floor(tradeCount / 2)) || 1;
          const toUnitPrice = (t: any) => {
            const area = parseAreaM2(t);
            return area && area > 0 ? t.dealAmount / area : null;
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
          lawdCd: latest.lawdCd,
          pyeongLookup: { name: latest.name, dong: latest.dong || '', aptSeq: latest.aptSeq ?? null, rawAreaM2: parseAreaM2(latest) },
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

      return { lawdCd, sidoCode: sidoCodeParam, sidoAll: isSidoAll, months, type, complexes, partial, failedDistricts: failedLawdCds };
    });

    // FIX_STATISTICS_DATA_TRUST — Unit Master 신뢰 가능한 평형만 batch 조회해
    // 화면 표시용 pyung을 채운다(단지 개수만큼 DB를 조회하지 않음, 쿼리 2회
    // 고정). 없으면 null(raw ㎡만 표시, 가짜 평형 생성 금지). `data`는
    // getOrSetCache가 보관하는 참조이므로 직접 mutate하지 않는다(그대로
    // mutate하면 다음 캐시 히트 때 pyeongLookup이 이미 제거된 상태로 재사용돼
    // 평형이 계속 null이 되는 캐시 오염 버그가 생긴다) — 응답 전용 새 배열을
    // 만든다.
    const lookupKeys: PyeongLookupKey[] = data.complexes
      .map((c: any) => c.pyeongLookup)
      .filter((k: PyeongLookupKey) => k.rawAreaM2 != null) as PyeongLookupKey[];
    const pyeongMap = await resolveTrustworthyPyeongBatch(prisma, lookupKeys);
    const complexesWithPyeong = data.complexes.map((c: any) => {
      const { pyeongLookup, ...rest } = c;
      return { ...rest, pyung: pyeongLookup.rawAreaM2 != null ? pyeongMap.get(pyeongLookupKeyId(pyeongLookup)) ?? null : null, exclusiveAreaM2: pyeongLookup.rawAreaM2 };
    });

    return NextResponse.json({ success: true, data: { ...data, complexes: complexesWithPyeong } });
  } catch (err) {
    console.error('Failed to fetch stats rankings:', err);
    return NextResponse.json({ success: false, error: 'API Error' });
  }
}
