// APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX
//
// /api/apt/[name]은 요청 하나가 여러 개의 (lawdCd, 월) 셀을 조회해 합친다. 그중 일부만
// 실패해도 성공한 월만 합쳐서 정상 응답처럼 돌려주면, 사용자에게는 "거래가 원래 이만큼
// 밖에 없다"로 읽힌다(실측: 같은 단지가 로컬 17건 / 부분 실패 시 7건). E-JIP 데이터
// 진실성 원칙의 핵심 위반이다 — FAILED는 절대 0건이 아니다.
//
// 이 모듈은 그 판정을 순수 함수로 분리한 것이다(네트워크/캐시 접근 없음). 실패 표현은
// 새로 만들지 않고 기존 계약을 그대로 읽는다: fetchMolitData()는 실패해도 throw하지 않고
// typeLabel:'에러' 플레이스홀더 1건짜리 배열을 반환하며, 이 판정식은 이미
// molit-stats-helpers.ts(통계 라우트)가 쓰던 것과 같은 규칙이다.

export type MolitMonthStatus = 'SUCCESS_WITH_DATA' | 'SUCCESS_EMPTY' | 'FAILED';

export const MOLIT_ERROR_TYPE_LABEL = '에러';

// 한 달치 조회 결과를 세 상태 중 하나로 분류한다.
// - 배열이 아니면(예외로 잡힌 값 등) FAILED — "모르면 0건"으로 낙관하지 않는다.
// - 에러 플레이스홀더가 하나라도 섞여 있으면 FAILED.
// - 빈 배열은 SUCCESS_EMPTY. 이건 "정상 응답 + 그 달 실거래 0건"이라는 진짜 사실이라
//   실패와 반드시 구분해야 한다(그렇지 않으면 모든 무거래 월이 오류로 보인다).
export function classifyMolitMonthResult(items: unknown): MolitMonthStatus {
  if (!Array.isArray(items)) return 'FAILED';
  if (items.some((item) => item && typeof item === 'object' && (item as { typeLabel?: unknown }).typeLabel === MOLIT_ERROR_TYPE_LABEL)) {
    return 'FAILED';
  }
  return items.length === 0 ? 'SUCCESS_EMPTY' : 'SUCCESS_WITH_DATA';
}

export interface MonthCellResult {
  dealYmd: string;
  status: MolitMonthStatus;
}

export interface TradeCompletenessSummary {
  monthsRequested: number;
  monthsSucceeded: number;
  /** 실패한 월(YYYYMM) 오름차순. 응답/로그가 요청 순서에 흔들리지 않도록 정렬한다. */
  failedMonths: string[];
  /** 한 달이라도 실패 — 집계를 "완전한 결과"로 제시하면 안 된다. */
  partial: boolean;
  /** 모든 월 실패 — 기존 apiError 조건과 동일(하위 호환 유지용). */
  allFailed: boolean;
}

export const MOLIT_GENERIC_FAILURE_MESSAGE = '공공데이터 API 호출에 실패했습니다.';

export interface MonthFetchOutcome {
  dealYmd: string;
  items: any[];
  status: MolitMonthStatus;
}

export interface FoldedMonthResults {
  /** 성공한 월의 원본 거래만. 실패 월의 에러 플레이스홀더는 절대 포함하지 않는다. */
  items: any[];
  cells: MonthCellResult[];
  /** 처음 만난 실패 월의 원본 사유(접두어 "API 에러: " 제거). 없으면 null. */
  upstreamFailureMessage: string | null;
}

// 월별 조회 결과를 라우트가 쓰는 세 가지(거래 원본 / 완전성 셀 / 원본 실패 사유)로 접는다.
// 이전 구현은 실패 월의 플레이스홀더까지 거래 배열에 그대로 넣은 뒤 단지명 필터가 조용히
// 걸러내는 구조였고, 그래서 "몇 개 월이 실패했는지"라는 사실이 집계 과정에서 사라졌다.
export function foldMonthResults(results: MonthFetchOutcome[]): FoldedMonthResults {
  const items: any[] = [];
  const cells: MonthCellResult[] = [];
  let upstreamFailureMessage: string | null = null;

  for (const result of results) {
    cells.push({ dealYmd: result.dealYmd, status: result.status });
    if (result.status === 'FAILED') {
      if (upstreamFailureMessage === null) {
        const placeholder = result.items?.find((item) => item?.typeLabel === MOLIT_ERROR_TYPE_LABEL);
        if (typeof placeholder?.name === 'string') {
          upstreamFailureMessage = placeholder.name.replace(/^API 에러: /, '');
        }
      }
      continue;
    }
    if (Array.isArray(result.items)) items.push(...result.items);
  }

  return { items, cells, upstreamFailureMessage };
}

// apiError의 의미는 기존 계약 그대로 유지한다: "요청한 모든 월이 실패했다".
// 일부 월 실패는 apiError가 아니라 partial로 표현한다(응답 필드).
export function resolveTradeApiError(
  summary: TradeCompletenessSummary,
  upstreamFailureMessage: string | null
): string | null {
  if (!summary.allFailed) return null;
  return upstreamFailureMessage || MOLIT_GENERIC_FAILURE_MESSAGE;
}

// 통계 라우트(stats/rankings, stats/region-change 등)가 이미 쓰는 표현과 같은 의미로
// 맞춘다: partial = 실패 셀이 하나라도 있음, apiError = 전 셀 실패.
export function summarizeTradeCompleteness(cells: MonthCellResult[]): TradeCompletenessSummary {
  const failedMonths = cells
    .filter((cell) => cell.status === 'FAILED')
    .map((cell) => cell.dealYmd)
    .sort();

  return {
    monthsRequested: cells.length,
    monthsSucceeded: cells.length - failedMonths.length,
    failedMonths,
    partial: failedMonths.length > 0,
    allFailed: cells.length > 0 && failedMonths.length === cells.length,
  };
}
