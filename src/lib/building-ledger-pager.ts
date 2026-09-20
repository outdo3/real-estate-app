// BUILDING_LEDGER_PAGINATION_FIX_V1 — 건축물대장(BldRgstHubService) 응답을 **끝까지** 모으는 공용 pager.
//
// 결함(실측 2026-09-20, 해운대구 우동 1104-1 / getBrTitleInfo):
//
//   numOfRows=5, pageNo 없음  → 응답 numOfRows=1, item 1건,  totalCount=14   ← 13건이 조용히 잘림
//   numOfRows=5, pageNo=1     → 응답 numOfRows=5, item 5건,  totalCount=14
//   numOfRows=100, pageNo=1   → item 14건(전부),              totalCount=14
//
// 즉 **pageNo를 보내지 않으면 서버가 numOfRows를 무시하고 1건만 준다.** 그 1건을 "이 지번의
// 전부"로 믿으면 14개 동 중 하나의 값을 단지 전체 값으로 저장하게 된다 — 실제로 그런 일이
// 있었다(26350-15 삼호가든맨션: 저장 세대수 90 = 한 개 동의 값).
//
// 더 나쁜 것은 이 잘림이 **기존 안전장치를 무력화**했다는 점이다. 부산 경로는 "표제부가 정확히
// 1건일 때만 신뢰한다"는 조건을 갖고 있었는데, 잘림 때문에 14건짜리 지번도 항상 1건으로 보여
// 그 조건이 한 번도 걸리지 않았다. 페이징을 고치면 그 조건이 비로소 제대로 작동한다.
//
// 이 모듈은 **수집만** 책임진다 — 어떤 레코드를 대표로 쓸지(선택 정책)는 호출부가 그대로 갖는다.
// 잘린 응답을 조용히 받아들이지 않는다: 모은 수가 totalCount에 못 미치면 PARTIAL이다.

/** 한 페이지 조회 결과. 호출부가 URL·키·타임아웃을 갖고 이 모양만 돌려준다. */
export type LedgerPageOutcome =
  | { kind: 'OK'; items: unknown[]; totalCount: number }
  | { kind: 'ERROR' | 'RATE_LIMITED'; detail: string };

export type LedgerPageFetcher = (pageNo: number, numOfRows: number) => Promise<LedgerPageOutcome>;

export type LedgerFetchStatus = 'COMPLETE' | 'EMPTY' | 'PARTIAL' | 'ERROR' | 'RATE_LIMITED';

export interface LedgerFetchResult {
  status: LedgerFetchStatus;
  /** COMPLETE일 때만 "이 지번의 전부"다. PARTIAL/ERROR면 신뢰하지 않는다. */
  items: unknown[];
  totalCount: number | null;
  pages: number;
  duplicatesRemoved: number;
  detail: string | null;
}

/** 공공데이터 포털 페이지 크기 상한 관례. 더 크게 요청해도 서버가 잘라 줄 수 있으므로 수집 수로 검증한다. */
export const LEDGER_PAGE_SIZE = 100;
/** 한 지번이 이보다 많은 건물을 가지면 수집을 멈추고 PARTIAL로 본다(무한 루프 방지). */
export const LEDGER_MAX_PAGES = 20;

/** totalCount와 페이지 크기로 필요한 페이지 수. 0이면 0. */
export function ledgerPageCount(totalCount: number, numOfRows: number): number {
  if (!Number.isFinite(totalCount) || totalCount <= 0) return 0;
  if (!Number.isFinite(numOfRows) || numOfRows <= 0) return 0;
  return Math.ceil(totalCount / numOfRows);
}

/**
 * 공식 식별자(mgmBldrgstPk)가 같은 레코드만 중복으로 제거한다. 식별자가 없으면 **제거하지 않는다**
 * — 이름·동명 같은 비공식 값으로 같은 건물이라고 추측하지 않는다.
 */
export function dedupeLedgerItems<T>(items: readonly T[]): { items: T[]; removed: number } {
  const seen = new Set<string>();
  const out: T[] = [];
  let removed = 0;
  for (const it of items) {
    const pk = String((it as { mgmBldrgstPk?: unknown })?.mgmBldrgstPk ?? '').trim();
    if (!pk) { out.push(it); continue; }
    if (seen.has(pk)) { removed++; continue; }
    seen.add(pk);
    out.push(it);
  }
  return { items: out, removed };
}

/**
 * 첫 페이지의 totalCount를 읽고 **필요한 페이지를 전부** 가져온다.
 *
 * 규칙:
 *  - pageNo는 항상 명시한다(1부터). 빼면 서버가 1건만 준다.
 *  - 모은 수 === totalCount일 때만 COMPLETE.
 *  - 중간 페이지가 비면 더 받을 게 없다고 보고, 그래도 totalCount에 못 미치면 PARTIAL.
 *  - 오류·제한은 그대로 올린다(빈 결과로 위장하지 않는다).
 */
export async function fetchAllLedgerPages(
  fetchPage: LedgerPageFetcher,
  opts: { numOfRows?: number; maxPages?: number } = {}
): Promise<LedgerFetchResult> {
  const numOfRows = opts.numOfRows ?? LEDGER_PAGE_SIZE;
  const maxPages = opts.maxPages ?? LEDGER_MAX_PAGES;

  const first = await fetchPage(1, numOfRows);
  if (first.kind !== 'OK') {
    return { status: first.kind, items: [], totalCount: null, pages: 1, duplicatesRemoved: 0, detail: first.detail };
  }
  const totalCount = first.totalCount;
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return { status: 'EMPTY', items: [], totalCount: Number.isFinite(totalCount) ? totalCount : null, pages: 1, duplicatesRemoved: 0, detail: null };
  }

  const collected: unknown[] = [...first.items];
  let pages = 1;

  // totalCount를 채울 때까지 계속 받는다. 페이지당 실제 건수가 요청한 numOfRows보다 적게 와도
  // (서버가 페이지 크기를 줄여 주는 경우) 다음 페이지를 시도한다 — 한 페이지만 보고 포기하면
  // 바로 그 잘림을 다시 받아들이는 셈이 된다. 상한은 maxPages가 잡는다.
  while (collected.length < totalCount && pages < maxPages) {
    const next = await fetchPage(pages + 1, numOfRows);
    pages++;
    if (next.kind !== 'OK') {
      return { status: next.kind, items: [], totalCount, pages, duplicatesRemoved: 0, detail: next.detail };
    }
    if (next.items.length === 0) break; // 더 받을 게 없다 — 아래에서 PARTIAL로 걸린다
    collected.push(...next.items);
  }

  const { items, removed } = dedupeLedgerItems(collected);
  // 중복을 뺀 뒤에도 totalCount와 같아야 "전부 모았다"고 말할 수 있다.
  // (서버가 같은 레코드를 두 페이지에 걸쳐 주면 removed>0이고 items<totalCount가 된다 → PARTIAL)
  if (items.length !== totalCount) {
    return {
      status: 'PARTIAL', items: [], totalCount, pages, duplicatesRemoved: removed,
      detail: `collected=${items.length} totalCount=${totalCount}`,
    };
  }
  return { status: 'COMPLETE', items, totalCount, pages, duplicatesRemoved: removed, detail: null };
}
