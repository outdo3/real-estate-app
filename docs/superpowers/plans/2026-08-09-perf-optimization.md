# 초기 로딩 성능 최적화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/api/stats/dashboard`(현재 최대 13년치 MOLIT 데이터를 매 요청마다 순차 재조회, 최소 10초 이상 소요)를 "최근 12개월 응답(빠름) + 연도별 표(지연 로딩)"로 분리하고, 반복 조회되는 지역/조건에 서버 TTL 캐시를 적용해 재방문 응답 속도를 크게 개선한다.

**Architecture:** 공용 TTL 캐시 헬퍼(`src/lib/server-cache.ts`)와 MOLIT 월별 조회 공용 로직(`src/lib/molit-stats-helpers.ts`)을 추출해 `/api/stats/dashboard`(축소됨)와 신규 `/api/stats/yearly`가 공유한다. 클라이언트(`stats-client.tsx`)는 연도별 표 데이터를 "표로 보기" 탭이 실제로 보여질 때만 SWR로 조건부 요청하고, 로딩 중에는 스켈레톤 행을 보여준다. `/api/school`, `/api/school/apartments`에도 동일한 캐시 헬퍼를 적용한다.

**Tech Stack:** Next.js 16 App Router, SWR(기존 유지, React Query 미도입), TypeScript. 테스트 프레임워크 없음 — `npm run build`가 검증 기준.

## Global Constraints

- React Query로 전환하지 않는다 — 기존 SWR 기반 그대로 유지.
- 서버 캐시는 외부 저장소(Redis 등) 없이 모듈 레벨 `Map` 기반 in-memory TTL 캐시로 구현한다(이 프로젝트 규모에 맞는 최소 구현, 기존 `lawdCdCache`/`geocodeCache` 패턴과 동일 스타일).
- 기존 UI/동작(탭 구조, 데이터 표시 방식)은 변경하지 않는다 — 이번 작업은 순수 성능/로딩 전략 개선이다. `chartView` 기본값(`'graph'`)도 이번 범위에서는 바꾸지 않는다(기본값 변경은 별도 "시장통계 탭 개선" 작업에서 다룬다).
- `/api/stats/dashboard`의 기존 요청 파라미터(`lawdCd` 또는 `sido`+`gungu`)와 성공/실패 응답 형태(`{ success, data }` / `{ success: false, error }`)는 유지하되, `data`에서 `yearlyTable` 필드만 제거한다(신규 `/api/stats/yearly`로 이동).
- `npm run build` 클린 통과가 각 태스크의 필수 검증 기준이다.

---

## Task 1: 공용 TTL 캐시 헬퍼 추가

**Files:**
- Create: `src/lib/server-cache.ts`

**Interfaces:**
- Produces: `getOrSetCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T>` — Task 2, 3, 5에서 사용.

- [ ] **Step 1: 작성**

```ts
const store = new Map<string, { value: unknown; expiresAt: number }>();

// 서버 인스턴스 생존 기간 동안만 유효한 TTL 캐시(재배포/재시작 시 초기화).
// MOLIT/NEIS 등 외부 API 응답처럼 자주 바뀌지 않는 데이터를 조건 키로 캐싱해,
// 같은 조건의 반복 요청이 매번 처음부터 재조회되는 것을 막는다.
export async function getOrSetCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fetcher();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-cache.ts
git commit -m "feat: 서버 TTL 캐시 헬퍼 추가"
```

---

## Task 2: MOLIT 월별 조회 공용 헬퍼 추출 + `/api/stats/dashboard` 롤링 전용화 + 캐시 적용

**Files:**
- Create: `src/lib/molit-stats-helpers.ts`
- Modify: `src/app/api/stats/dashboard/route.ts` (전체 재작성)

**Interfaces:**
- Consumes: `getOrSetCache`(Task 1)
- Produces: `resolveLawdCd(sido, gungu): Promise<string | null>`, `isValidTrade(item): boolean`, `fetchMonthsThrottled(tasks, concurrency?): Promise<Record<string, any[]>>`, `MonthTask` 타입 — Task 3(`/api/stats/yearly`)에서 재사용.

- [ ] **Step 1: `src/lib/molit-stats-helpers.ts` 작성**

```ts
import { fetchMolitData } from '@/lib/api-molit';

export const REGCODE_PROXY = 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes';

// 지역코드 캐시: 같은 시/군/구 조합에 대한 반복 조회를 줄인다 (서버 인스턴스 생존 기간 동안 재사용)
const lawdCdCache = new Map<string, string | null>();

// 시/도 + 시/군/구 이름을 카카오맵 검색 모달(page.tsx)과 동일한 방식으로
// 공공 법정동코드 프록시에서 조회해 5자리 lawdCd로 변환한다.
export async function resolveLawdCd(sido: string, gungu: string): Promise<string | null> {
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

    // 완전 일치만 허용한다("강서구".includes("서구") === true 같은 오매칭 방지).
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

export const isValidTrade = (item: any) => item && item.typeLabel !== '에러' && item.dealAmount > 0;

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

export interface MonthTask {
  key: string;
  lawdCd: string;
  dealYmd: string;
  type: 'apt' | 'rent';
}

// 여러 월별 조회를 하나의 공용 큐로 모아 동시성을 낮게 고정한 워커 풀로 순차 처리한다.
// 호출부가 여러 배치로 나눠 각각 병렬 호출하면 배치마다 다시 동시 요청이 몰려 초당
// 제한에 걸리므로, 항상 하나의 큐로 합쳐 넘겨야 실제 동시 요청 수를 안정적으로 제한할 수 있다.
export async function fetchMonthsThrottled(tasks: MonthTask[], concurrency = 3): Promise<Record<string, any[]>> {
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
```

- [ ] **Step 2: `src/app/api/stats/dashboard/route.ts` 전체를 다음 내용으로 교체**

(연도별 통계표 관련 로직 전부 제거, 나머지 계산은 `getOrSetCache`로 감싸 30분 캐시. `resolveLawdCd`/`isValidTrade`/`fetchMonthsThrottled`/`MonthTask`는 Step 1의 공용 헬퍼에서 import.)

```ts
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

    const data = await getOrSetCache(`stats-dashboard:${lawdCd}`, 30 * 60 * 1000, async () => {
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
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Failed to fetch dashboard molit data:', err);
    return NextResponse.json({ success: false, error: 'API Error' });
  }
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 4: Commit**

```bash
git add src/lib/molit-stats-helpers.ts src/app/api/stats/dashboard/route.ts
git commit -m "perf: MOLIT 월별 조회 공용 헬퍼 추출, dashboard API를 최근 12개월 전용 + 캐시 적용으로 축소"
```

---

## Task 3: `/api/stats/yearly` 신규 생성 (연도별 통계표 분리)

**Files:**
- Create: `src/app/api/stats/yearly/route.ts`

**Interfaces:**
- Consumes: `getOrSetCache`(Task 1), `resolveLawdCd`/`isValidTrade`/`fetchMonthsThrottled`/`MonthTask`(Task 2의 `src/lib/molit-stats-helpers.ts`)
- Produces: `GET /api/stats/yearly?lawdCd=...` (또는 `sido`+`gungu`) → `{ success: true, data: { yearlyTable: Array<{ year, count, maxPrice, minPrice, avgPrice }> } }` — Task 4(`stats-client.tsx`)에서 사용.

- [ ] **Step 1: 작성**

```ts
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

    const yearlyTable = await getOrSetCache(`stats-yearly:${lawdCd}`, 60 * 60 * 1000, async () => {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthIndex = now.getMonth();
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

      const taskResults = await fetchMonthsThrottled(yearlyTasks);

      return years.map((year) => {
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
    });

    return NextResponse.json({ success: true, data: { yearlyTable } });
  } catch (err) {
    console.error('Failed to fetch yearly molit data:', err);
    return NextResponse.json({ success: false, error: 'API Error' });
  }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 3: 수동 스모크 테스트**

Run: `npm run dev` → `http://localhost:3000/api/stats/yearly?lawdCd=11680` 접속 → `{ "success": true, "data": { "yearlyTable": [...] } }` 형태 응답 확인 (연도별 데이터 배열, 2014년부터 현재까지). 첫 요청은 느릴 수 있으나(신규 조회) 같은 URL로 재요청 시 즉시 응답되는지 확인(캐시 히트). dev 서버 종료.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/stats/yearly/route.ts
git commit -m "feat: 연도별 통계표를 /api/stats/yearly로 분리, 60분 캐시 적용"
```

---

## Task 4: `stats-client.tsx` — 연도별 표 지연 로딩 + 스켈레톤 UI

**Files:**
- Modify: `src/app/stats/stats-client.tsx`
- Modify: `src/app/stats/page.module.css`

**Interfaces:**
- Consumes: `GET /api/stats/yearly?lawdCd=...`(Task 3)

- [ ] **Step 1: 두 번째 SWR 훅 추가**

`src/app/stats/stats-client.tsx`에서 기존 (현재 76~80번째 줄 부근):
```tsx
  const { data: apiResponse, error: swrError, isLoading } = useSWR(
    region.lawdCd ? `/api/stats/dashboard?lawdCd=${region.lawdCd}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );
```
바로 다음 줄에 추가:
```tsx

  // 연도별 통계표는 무거운 조회라, "표로 보기"가 실제로 선택됐을 때만 요청한다
  // (그래프 보기만 쓰는 사용자는 이 요청 자체가 나가지 않음).
  const { data: yearlyResponse, isLoading: yearlyLoading } = useSWR(
    region.lawdCd && chartView === 'table' ? `/api/stats/yearly?lawdCd=${region.lawdCd}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );
  const yearlyTable = yearlyResponse?.success ? yearlyResponse.data.yearlyTable : null;
```

(`chartView` state는 이 시점에 이미 위쪽에서 `useState`로 선언되어 있으므로 그대로 참조 가능.)

- [ ] **Step 2: 연도별 표 렌더링을 `data.yearlyTable` 대신 `yearlyTable`로 교체 + 로딩 스켈레톤 추가**

현재(표로 보기 분기, 약 249~276번째 줄):
```tsx
                ) : (
                  <div className={styles.panelBody}>
                    <div className={styles.tableWrapper}>
                      <table className={styles.yearlyTable}>
                        <thead>
                          <tr>
                            <th>거래년월</th>
                            <th>최고가</th>
                            <th>최저가</th>
                            <th>평균가</th>
                            <th>거래량(건)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...data.yearlyTable].reverse().map((row: any) => (
                            <tr key={row.year}>
                              <td className={styles.yearlyTableYear}>{row.year}년</td>
                              <td>{row.maxPrice || '-'}</td>
                              <td>{row.minPrice || '-'}</td>
                              <td>{row.avgPrice || '-'}</td>
                              <td>{row.count.toLocaleString('ko-KR')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
```

다음으로 교체:
```tsx
                ) : (
                  <div className={styles.panelBody}>
                    <div className={styles.tableWrapper}>
                      <table className={styles.yearlyTable}>
                        <thead>
                          <tr>
                            <th>거래년월</th>
                            <th>최고가</th>
                            <th>최저가</th>
                            <th>평균가</th>
                            <th>거래량(건)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {!yearlyTable ? (
                            Array.from({ length: 6 }).map((_, i) => (
                              <tr key={`skeleton-${i}`}>
                                <td colSpan={5}>
                                  <div className={styles.skeletonBar} />
                                </td>
                              </tr>
                            ))
                          ) : (
                            [...yearlyTable].reverse().map((row: any) => (
                              <tr key={row.year}>
                                <td className={styles.yearlyTableYear}>{row.year}년</td>
                                <td>{row.maxPrice || '-'}</td>
                                <td>{row.minPrice || '-'}</td>
                                <td>{row.avgPrice || '-'}</td>
                                <td>{row.count.toLocaleString('ko-KR')}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
```

(`yearlyLoading` 변수는 `!yearlyTable` 조건과 사실상 동일하게 동작하므로 별도로 쓰지 않는다 — `yearlyTable`이 아직 없으면 로딩 중이거나 요청 전이거나 둘 다 스켈레톤을 보여주는 게 맞다.)

- [ ] **Step 3: 스켈레톤 CSS 추가**

`src/app/stats/page.module.css` 파일 끝에 추가:
```css
.skeletonBar {
  height: 1rem;
  border-radius: 4px;
  background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 37%, #e2e8f0 63%);
  background-size: 400% 100%;
  animation: skeleton-pulse 1.4s ease infinite;
}

@keyframes skeleton-pulse {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 5: 수동 스모크 테스트**

Run: `npm run dev` → `/stats` 접속 → "거래량 분석" 탭에서 "📋 표로 보기" 클릭 → 표 영역에 회색 펄스 스켈레톤이 잠깐 보이다가 실제 연도별 데이터로 바뀌는지 확인. "그래프 보기"만 사용할 때는 `/api/stats/yearly` 요청이 전혀 나가지 않는지(브라우저 개발자도구 Network 탭) 확인. dev 서버 종료.

- [ ] **Step 6: Commit**

```bash
git add src/app/stats/stats-client.tsx src/app/stats/page.module.css
git commit -m "perf: 연도별 통계표를 표로 보기 탭 진입 시에만 지연 로딩, 스켈레톤 UI 추가"
```

---

## Task 5: `/api/school`, `/api/school/apartments`에 캐시 적용

**Files:**
- Modify: `src/app/api/school/route.ts`
- Modify: `src/app/api/school/apartments/route.ts`

**Interfaces:**
- Consumes: `getOrSetCache`(Task 1)

- [ ] **Step 1: `src/app/api/school/route.ts` 전체를 다음 내용으로 교체 (NEIS 조회+가공 로직을 캐시로 감싸기)**

```ts
import { NextResponse } from 'next/server';
import { resolveNeisEduCode, addressMatchesRegion } from '@/lib/neis-sido-codes';
import { getOrSetCache } from '@/lib/server-cache';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || '부산광역시 서구';
  const type = searchParams.get('type') || '중등';
  const [sido] = region.split(' ');

  // NEIS API KEY (환경변수 또는 샘플)
  const apiKey = process.env.NEIS_API_KEY || 'sample';

  const eduCode = resolveNeisEduCode(sido) || 'C10';

  try {
    const result = await getOrSetCache(`school-list:${region}:${type}`, 60 * 60 * 1000, async () => {
      let rawSchools: any[] = [];

      try {
        const pageSize = 500;
        let pIndex = 1;
        let totalCount = Infinity;

        while ((pIndex - 1) * pageSize < totalCount) {
          const neisUrl = `https://open.neis.go.kr/hub/schoolInfo?KEY=${apiKey}&Type=json&pIndex=${pIndex}&pSize=${pageSize}&ATPT_OFCDC_SC_CODE=${eduCode}`;
          const res = await fetch(neisUrl);
          if (!res.ok) break;
          const data = await res.json();
          totalCount = data.schoolInfo?.[0]?.head?.[0]?.list_total_count ?? 0;
          const rows = data.schoolInfo?.[1]?.row || [];
          if (rows.length === 0) break;
          rawSchools = rawSchools.concat(rows);
          pIndex++;
        }
      } catch (e) {
        console.warn("NEIS API 호출 실패, Fallback 적용", e);
      }

      if (rawSchools.length === 0) {
        rawSchools = [
          { SCHUL_NM: '대신중학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '중학교', HMPG_ADRES: 'http://daeshin.ms.kr', SD_SCHUL_CODE: '1' },
          { SCHUL_NM: '경남중학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '중학교', HMPG_ADRES: 'http://kyungnam.ms.kr', SD_SCHUL_CODE: '2' },
          { SCHUL_NM: '부경중학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '중학교', HMPG_ADRES: 'http://pukyong.ms.kr', SD_SCHUL_CODE: '3' },

          { SCHUL_NM: '송도초등학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '초등학교', HMPG_ADRES: 'http://songdo.es.kr', SD_SCHUL_CODE: '4' },
          { SCHUL_NM: '천마초등학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '초등학교', HMPG_ADRES: 'http://chunma.es.kr', SD_SCHUL_CODE: '5' },

          { SCHUL_NM: '부경고등학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '고등학교', HMPG_ADRES: 'http://pukyong.hs.kr', SD_SCHUL_CODE: '6' },
          { SCHUL_NM: '경남고등학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '고등학교', HMPG_ADRES: 'http://kyungnam.hs.kr', SD_SCHUL_CODE: '7' }
        ];
      }

      const gungu = region.split(' ')[1] || '';
      let filtered = rawSchools.filter((s: any) => {
        const addr = (s.ORG_RDNMA || s.LCTN_SC_NM || '');
        if (addressMatchesRegion(addr, region, gungu)) return true;
        if (region === '부산광역시 서구' && s.SCHUL_NM.includes('대신')) return true;
        return false;
      });

      const kindMap: Record<string, string> = {
        '초등': '초등학교',
        '중등': '중학교',
        '고등': '고등학교'
      };
      const targetKind = kindMap[type];
      if (targetKind) {
        filtered = filtered.filter((s: any) => s.SCHUL_KND_SC_NM === targetKind);
      }

      const mapped = filtered.map((s: any, index: number) => {
        const nameHash = s.SCHUL_NM.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
        const seed1 = (nameHash % 100) / 100;
        const seed2 = ((nameHash * 3) % 100) / 100;

        const classStudents = Math.floor(seed1 * 13) + 15;
        const students = classStudents * (Math.floor(seed2 * 15) + 10);

        if (type === '초등') {
          const isChopuma = seed1 > 0.8;
          return {
            id: s.SD_SCHUL_CODE || `e${index}`,
            name: s.SCHUL_NM,
            rank: index + 1,
            students: students,
            graduates: Math.floor(students / 6),
            classStudents: classStudents,
            walkTime: isChopuma ? '도보 1분' : `도보 ${Math.floor(seed2 * 10) + 3}분`,
            crossRoad: isChopuma ? '단지 내 (초품아)' : `건널목 ${Math.floor(seed1 * 3) + 1}개`
          };
        } else if (type === '중등') {
          const achievement = Math.floor(seed1 * 33) + 65;
          const graduates = Math.floor(students / 3);
          const special = Math.floor(students * (seed2 * 0.05));
          const sciHigh = Math.floor(special * (seed1 * 0.5 + 0.1));
          const foreignHigh = special - sciHigh;

          return {
            id: s.SD_SCHUL_CODE || `m${index}`,
            name: s.SCHUL_NM,
            rank: index + 1,
            students: students,
            graduates: graduates,
            classStudents: classStudents,
            achievement: achievement,
            specialHigh: special,
            sciHigh: sciHigh,
            foreignHigh: foreignHigh,
            specialRatio: graduates > 0 ? ((special / graduates) * 100).toFixed(1) : "0.0"
          };
        } else {
          const graduates = Math.floor(students / 3);
          return {
            id: s.SD_SCHUL_CODE || `h${index}`,
            name: s.SCHUL_NM,
            rank: index + 1,
            students: students,
            graduates: graduates,
            classStudents: classStudents,
            univRate: (seed1 * 45 + 40).toFixed(1),
            medSeoulRate: (seed2 * 10 + 2).toFixed(1),
            type: s.HS_GNRL_BUSNS_SC_NM || (seed1 > 0.8 ? '자율고' : '일반고')
          };
        }
      });

      if (type === '중등') mapped.sort((a: any, b: any) => parseFloat(b.specialRatio) - parseFloat(a.specialRatio));
      if (type === '고등') mapped.sort((a: any, b: any) => parseFloat(b.univRate) - parseFloat(a.univRate));

      mapped.forEach((r: any, idx: number) => r.rank = idx + 1);

      return mapped;
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('School API Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch school data' }, { status: 500 });
  }
}
```

(내부에서 `let rawSchools`부터 매핑까지 쓰던 변수명 `result`는 바깥의 `const result = await getOrSetCache(...)`와 이름이 겹치지 않도록 `mapped`로 이름을 바꿨다 — 로직은 원본과 동일하다.)

- [ ] **Step 2: `src/app/api/school/apartments/route.ts` 전체를 다음 내용으로 교체 (계산 로직을 캐시로 감싸고, "매물 없음" 폴백은 캐시 밖에서 처리)**

```ts
import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
import { fetchMolitData } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';

const normalizeAptName = (name: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const schoolName = searchParams.get('schoolName') || '';
  const latParam = searchParams.get('lat');
  const lngParam = searchParams.get('lng');
  const lawdCd = searchParams.get('lawdCd') || '';

  if (!schoolName) {
    return NextResponse.json({ success: false, error: 'School name is required' }, { status: 400 });
  }

  try {
    const cacheKey = `school-apts:${schoolName}:${lawdCd}:${latParam || ''}:${lngParam || ''}`;

    const result = await getOrSetCache(cacheKey, 30 * 60 * 1000, async () => {
      let schoolCoords = [129.0225, 35.0772]; // Default (송도)

      if (latParam && lngParam) {
        schoolCoords = [parseFloat(lngParam), parseFloat(latParam)];
      } else {
        // 카카오 로컬 API를 사용하여 학교 이름으로 실제 좌표 검색
        const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
        if (kakaoKey) {
          try {
            const kakaoUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(schoolName)}`;
            const kakaoRes = await fetch(kakaoUrl, {
              headers: {
                'Authorization': `KakaoAK ${kakaoKey}`,
                'KA': 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
                'Origin': 'http://localhost:3000'
              }
            });
            if (kakaoRes.ok) {
              const kakaoData = await kakaoRes.json();
              if (kakaoData.documents && kakaoData.documents.length > 0) {
                const doc = kakaoData.documents[0];
                schoolCoords = [parseFloat(doc.x), parseFloat(doc.y)];
              }
            }
          } catch (err) {
            console.warn("Kakao API failed for school coords, using fallback", err);
          }
        }

        // 검색 실패시 기본 폴백 (기존 유지)
        if (!kakaoKey || schoolCoords[0] === 129.0225) {
          if (schoolName.includes('대신') || schoolName.includes('경남') || schoolName.includes('부경') || schoolName.includes('중앙') || schoolName.includes('구덕') || schoolName.includes('동신') || schoolName.includes('화랑')) {
            schoolCoords = [129.015, 35.115]; // 대신동 일대
          } else if (schoolName.includes('송도') || schoolName.includes('천마') || schoolName.includes('알로이시오')) {
            schoolCoords = [129.022, 35.075]; // 송도동 일대
          } else if (schoolName.includes('초장') || schoolName.includes('남부') || schoolName.includes('아미') || schoolName.includes('토성')) {
            schoolCoords = [129.010, 35.100]; // 충무동 일대
          }
        }
      }

      const schoolPoint = point(schoolCoords);

      // 2. 카카오 로컬 API로 반경 1.5km 내 아파트 검색 (키워드: 아파트)
      const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
      let searchedApartments: any[] = [];
      if (kakaoKey) {
        try {
          const radiusUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent('아파트')}&x=${schoolCoords[0]}&y=${schoolCoords[1]}&radius=1500`;
          const radiusRes = await fetch(radiusUrl, {
            headers: {
              'Authorization': `KakaoAK ${kakaoKey}`,
              'KA': 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
              'Origin': 'http://localhost:3000'
            }
          });
          if (radiusRes.ok) {
            const radiusData = await radiusRes.json();
            searchedApartments = radiusData.documents || [];
          }
        } catch (err) {
          console.error("Failed to fetch apartments from Kakao", err);
        }
      }

      // 실거래가/준공연도: 공공데이터포털(MOLIT) 최근 12개월 매매 데이터에서 이름 매칭으로 조회
      const realAptInfo = new Map<string, { priceStr: string; buildYear: number | null }>();
      if (lawdCd) {
        try {
          const now = new Date();
          const months = Array.from({ length: 12 }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
          });
          const monthlyResults = await Promise.all(
            months.map(dealYmd => fetchMolitData({ type: 'apt', lawdCd, dealYmd }).catch(() => []))
          );
          for (const trades of monthlyResults) {
            for (const t of trades as any[]) {
              const key = normalizeAptName(t.name);
              if (!key || realAptInfo.has(key)) continue;
              realAptInfo.set(key, {
                priceStr: t.price,
                buildYear: t.buildYear ? parseInt(t.buildYear, 10) : null,
              });
            }
          }
        } catch (e) {
          console.warn('Failed to load real MOLIT data for nearby apartments', e);
        }
      }

      // 3. Turf.js를 사용하여 학교와 아파트 간의 직선거리(반경) 계산
      const apartmentsWithDistance = searchedApartments.map(apt => {
        const aptPoint = point([parseFloat(apt.x), parseFloat(apt.y)]);
        const dist = distance(schoolPoint, aptPoint, { units: 'kilometers' });

        const cleanName = apt.place_name.replace(/ 아파트$/, '').trim();
        const matched = realAptInfo.get(normalizeAptName(cleanName));

        return {
          id: apt.id,
          name: cleanName,
          price: matched?.priceStr || '가격 정보 없음',
          buildYear: matched?.buildYear ?? null,
          dist
        };
      });

      // 4. 반경 1.5km 이내 아파트 필터 및 거리순(오름차순) 정렬
      const nearbyApartments = apartmentsWithDistance
        .filter(apt => apt.dist <= 1.5)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5);

      // 5. 프론트엔드용 데이터 가공 (현실적인 도보 시간 계산 알고리즘)
      return nearbyApartments.map(apt => {
        const realDistance = apt.dist * 1.45;

        let walkMin = Math.round(realDistance * 15);

        if (apt.dist > 0.1) {
          walkMin += 4;
        }
        if (apt.dist > 0.5) {
          walkMin += 3;
        }

        if (schoolName.includes('송도')) {
          walkMin += 5;
        }

        walkMin = Math.max(3, walkMin);

        return {
          id: apt.id,
          name: apt.name,
          price: apt.price,
          walkTime: `도보 ${walkMin}분`,
          distance: apt.dist,
          buildYear: apt.buildYear
        };
      });
    });

    const finalResult = result.length === 0
      ? [{ id: -1, name: '인근 아파트 매물 없음', price: '-', walkTime: '-', distance: 0, buildYear: null }]
      : result;

    return NextResponse.json({ success: true, data: finalResult });

  } catch (error) {
    console.error('GIS Mapping Error:', error);
    return NextResponse.json({ success: false, error: 'GIS processing failed' }, { status: 500 });
  }
}
```

기존 `if (result.length === 0) { result.push({...}); }` 방식(캐시된 배열을 직접 mutate)은 제거하고 위처럼 캐시 조회 후 `finalResult`로 조건부 반환하도록 바꿨다 — 캐시된 배열을 직접 push로 변형하면 같은 캐시가 재사용될 때마다 항목이 계속 누적되는 버그가 생기기 때문이다.

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 4: 수동 스모크 테스트**

Run: `npm run dev` →
1. `http://localhost:3000/api/school?region=서울특별시%20강남구&type=중등`을 두 번 연속 요청 — 두 번째가 캐시로 빠르게 응답되는지 확인.
2. `/school` 페이지에서 학교를 하나 클릭해 "배정가능단지" 패널이 정상적으로 뜨는지, 같은 학교를 다시 클릭했을 때 더 빠르게 뜨는지 확인.
3. 아파트 목록이 원래 없던 지역/좌표 조합을 사용해 "인근 아파트 매물 없음"이 정상적으로 표시되는지(반복 클릭해도 목록이 누적되지 않는지) 확인.
dev 서버 종료.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/school/route.ts src/app/api/school/apartments/route.ts
git commit -m "perf: 학군정보 API 2종에 서버 캐시 적용"
```

---

## Task 6: 최종 클린 빌드 확인

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 클린 빌드**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: git 상태 확인**

Run: `git status`
Expected: 커밋되지 않은 변경 없음.

(이번 작업은 아직 push하지 않는다 — 브랜드명 변경 및 이후 남은 작업들과 함께 사용자가 지정하는 시점에 push한다.)
