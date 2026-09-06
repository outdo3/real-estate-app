// APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX §CACHE_SAFETY
//
// MOLIT 월별 조회 + TTL 캐시를 한 곳으로 모은다. 이전에는 /api/apt/[name]과
// /api/presales/[id]/nearby-market이 각자 `getOrSetCache('molit:...')`를 직접 호출했고,
// fetchMolitData()가 실패 시 반환하는 typeLabel:'에러' 플레이스홀더가 성공 결과와 똑같이
// 1시간 캐시에 들어갔다 — 한 번의 스로틀링이 그 (지역, 월) 셀을 1시간 동안 "거래 없음"
// 으로 고정시켰다(부분 실패가 조용한 과소집계로 굳는 경로).
//
// 캐시 키 형식은 기존과 100% 동일하게 유지한다(`molit:{type}:{lawdCd}:{dealYmd}`) —
// 두 라우트가 같은 원본 월 데이터를 계속 공유해야 하므로 키를 바꾸면 안 된다.
import { fetchMolitData, type DataType } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { classifyMolitMonthResult, type MolitMonthStatus } from '@/lib/apt-trade-completeness';

// 과거 실거래는 사실상 불변이라 기존과 동일한 1시간 TTL을 유지한다.
export const MOLIT_MONTH_CACHE_TTL_MS = 3600 * 1000;

export function molitMonthCacheKey(type: string, lawdCd: string, dealYmd: string): string {
  return `molit:${type}:${lawdCd}:${dealYmd}`;
}

export interface MolitMonthFetchParams {
  type: DataType;
  lawdCd: string;
  dealYmd: string;
}

export interface MolitMonthFetchResult {
  items: any[];
  status: MolitMonthStatus;
}

interface MolitMonthDeps {
  /** 테스트용 주입 지점. 기본값은 실제 MOLIT 호출. */
  fetchMonth?: (params: MolitMonthFetchParams) => Promise<any[]>;
}

export async function fetchMolitMonthCached(
  params: MolitMonthFetchParams,
  deps?: MolitMonthDeps
): Promise<MolitMonthFetchResult> {
  const { type, lawdCd, dealYmd } = params;
  const fetchMonth = deps?.fetchMonth ?? ((p: MolitMonthFetchParams) => fetchMolitData(p));

  try {
    const items = await getOrSetCache(
      molitMonthCacheKey(type, lawdCd, dealYmd),
      MOLIT_MONTH_CACHE_TTL_MS,
      () => fetchMonth({ type, lawdCd, dealYmd }),
      // 실패한 월은 캐시에 남기지 않는다 — 다음 요청이 다시 시도해 회복할 수 있어야 한다.
      // 이미 캐시된 정상 결과는 TTL 안에서 재조회 자체가 일어나지 않으므로 덮이지 않는다.
      { shouldCache: (value) => classifyMolitMonthResult(value) !== 'FAILED' }
    );
    return { items: Array.isArray(items) ? items : [], status: classifyMolitMonthResult(items) };
  } catch (e) {
    // fetchMolitData는 보통 throw하지 않지만(플레이스홀더 반환), 예외가 나면 0건으로
    // 낙관하지 않고 명시적 실패로 돌려준다.
    console.warn(`[molit] 월 조회 예외 type=${type} lawdCd=${lawdCd} dealYmd=${dealYmd}: ${(e as Error)?.message}`);
    return { items: [], status: 'FAILED' };
  }
}
