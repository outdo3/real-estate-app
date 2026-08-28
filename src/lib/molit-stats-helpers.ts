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
// STATISTICS REGION FILTER V2 §35/36 — "시도 전체" 집계처럼 여러 lawdCd를 한 번에
// 조회할 때는 그중 일부만 실패해도(예: 16개 구 중 1개 실패) 전체를 "거래 0건"으로
// 보여주면 안 된다. 재시도까지 실패했는지(failed=true) 여부를 유지해서 반환하고,
// 기존 `fetchMonthsThrottled`(아래)는 이 정보를 버리고 items만 돌려주는 하위호환
// 래퍼로 남긴다 — 기존 rankings/dashboard/yearly/feed 호출부는 전혀 바뀌지 않는다.
async function fetchMonthWithRetry(lawdCd: string, dealYmd: string, type: 'apt' | 'rent'): Promise<{ items: any[]; failed: boolean }> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const result = await fetchMolitData({ type, lawdCd, dealYmd });
      const failed = result.length === 1 && result[0]?.typeLabel === '에러';
      if (!failed) return { items: result, failed: false };
    } catch (e) {
      // fetchMolitData가 예외적으로 throw하는 경우에도 재시도 대상으로 취급
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return { items: [], failed: true };
}

export interface MonthTask {
  key: string;
  lawdCd: string;
  dealYmd: string;
  type: 'apt' | 'rent';
}

// STATISTICS PERFORMANCE V1 §8/§31/§32 — 기존 3은 과거 "초당 서비스 요청제한
// 횟수 초과" 에러를 겪은 뒤 보수적으로 굳힌 값이었다. 권장 범위(4~8) 안에서
// 6으로 올리고 부산/서울 SIDO_ALL cold 반복 실행으로 partial/failedDistricts
// 증가 여부를 실측 검증했다(docs/development/STATISTICS_PERFORMANCE_V1.md
// §Concurrency 참고). 각 슬롯은 여전히 fetchMonthGated에서 최소 200ms를 쥔
// 채로 유지되므로 순간 최대 요청 수는 6개로 유지된다. 이후 배포 환경에서
// 스로틀링(failedDistricts 증가)이 관측되면 이 값만 낮추면 된다.
const GLOBAL_MOLIT_CONCURRENCY = 6;
let activeMolitRequests = 0;
const molitWaitQueue: Array<() => void> = [];

function acquireMolitSlot(): Promise<void> {
  if (activeMolitRequests < GLOBAL_MOLIT_CONCURRENCY) {
    activeMolitRequests++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    molitWaitQueue.push(() => {
      activeMolitRequests++;
      resolve();
    });
  });
}

function releaseMolitSlot(): void {
  activeMolitRequests--;
  const next = molitWaitQueue.shift();
  if (next) next();
}

async function fetchMonthGated(lawdCd: string, dealYmd: string, type: 'apt' | 'rent'): Promise<{ items: any[]; failed: boolean }> {
  await acquireMolitSlot();
  try {
    const result = await fetchMonthWithRetry(lawdCd, dealYmd, type);
    // 초당 요청 수를 낮게 유지하기 위한 페이싱: 슬롯을 쥔 채로 대기해야
    // 전역 동시 요청 수 자체가 실제로 제한된다.
    await new Promise((r) => setTimeout(r, 200));
    return result;
  } finally {
    releaseMolitSlot();
  }
}

// 여러 월별 조회를 하나의 전역 세마포어로 게이팅해, 서로 다른 라우트(예: 대시보드와
// 연도별 통계)가 동시에 호출되어도 전체 프로세스 기준 동시 MOLIT 요청 수가 항상
// GLOBAL_MOLIT_CONCURRENCY를 넘지 않도록 보장한다. 호출별로 워커 풀을 새로 만들면
// 두 라우트가 동시에 실행될 때 실제 동시 요청 수가 배로 늘어나 초당 제한에 걸리므로,
// 반드시 모듈 레벨에서 공유해야 한다.
export interface MonthTaskResult {
  items: any[];
  failed: boolean;
}

// 신규 — 시도 전체처럼 여러 lawdCd를 aggregation할 때 부분 실패를 정직하게
// 구분해야 하는 호출부용(§35/36). 기존 fetchMonthsThrottled와 동일한 공유
// 세마포어를 그대로 쓴다(별도 동시성 풀 없음).
export async function fetchMonthsThrottledWithStatus(tasks: MonthTask[]): Promise<Record<string, MonthTaskResult>> {
  const results: Record<string, MonthTaskResult> = {};
  await Promise.all(
    tasks.map(async (task) => {
      results[task.key] = await fetchMonthGated(task.lawdCd, task.dealYmd, task.type);
    })
  );
  return results;
}

export async function fetchMonthsThrottled(tasks: MonthTask[]): Promise<Record<string, any[]>> {
  const full = await fetchMonthsThrottledWithStatus(tasks);
  const results: Record<string, any[]> = {};
  for (const key in full) results[key] = full[key].items;
  return results;
}
