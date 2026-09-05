// PERFORMANCE_V2 §10 — 거래량(실거래 피드) 목록 누적의 **순수 로직**.
//
// 왜 분리했는가(실제 버그):
//   TransactionFeedView는 SWR의 `onSuccess` 안에서 `setAllTrades(...)`로 목록을 상태에
//   복사하고 있었다. 그런데 `onSuccess`는 **실제 fetch가 일어났을 때만** 호출된다.
//   전체 → 매매 → 전체 로 돌아오면 첫 번째 키가 이미 SWR 캐시에 있고
//   (`dedupingInterval: 60s`) 재요청이 없으므로 `onSuccess`가 불리지 않는다. 필터 핸들러는
//   이미 `setAllTrades([])`를 해 둔 상태라, `data`는 정상인데 목록 상태만 빈 배열로 남는다.
//   상단 지표는 `data.summary`에서 직접 읽으므로 갱신되고 **하단 단지 목록만 사라진다** —
//   사용자가 보고한 증상과 정확히 일치한다(전체→매매→전체, 전체→전세, 매매→전세→전체).
//
// 그래서 목록은 "이벤트로 복사"하지 않고 **현재 응답에서 파생**시킨다. 페이지네이션
// (더보기)만 offset별로 누적하며, 누적본에는 그것을 만든 쿼리 키를 함께 들고 다닌다.
//
// zero-import 유지 — `node --experimental-strip-types --test`가 확장자 없는 상대 import를
// 해석하지 못한다(프로젝트의 다른 *-logic.ts와 동일 제약).

export interface FeedQueryIdentity {
  lawdCd: string | null;
  sidoCode: string;
  dong: string;
  preset: string;
  dealType: string;
}

/**
 * 목록 누적의 유효 범위를 정하는 키. **dealType이 반드시 들어간다** — 이것이 빠지면
 * 필터를 바꿔도 이전 필터의 누적본이 그대로 남는다(원래 버그의 거울상).
 */
export function buildFeedQueryKey(q: FeedQueryIdentity): string {
  const region = q.lawdCd ? `lawd:${q.lawdCd}|dong:${q.dong}` : `sido:${q.sidoCode}`;
  return `${region}|period:${q.preset}|deal:${q.dealType || 'all'}`;
}

export interface FeedPages<T> {
  key: string;
  /** offset -> 그 페이지의 행들. 더보기로 늘어난 페이지를 순서대로 되살리기 위함. */
  byOffset: Record<number, T[]>;
}

export function emptyFeedPages<T>(key: string): FeedPages<T> {
  return { key, byOffset: {} };
}

/**
 * 응답 한 페이지를 누적본에 반영한다.
 *
 * - 키가 달라졌으면 이전 누적을 버리고 새 키로 시작한다(필터/지역이 바뀐 것).
 * - 같은 키의 같은 offset이 이미 같은 내용이면 **이전 객체를 그대로 돌려준다** —
 *   불필요한 리렌더를 만들지 않기 위해서다.
 */
export function mergeFeedPage<T>(prev: FeedPages<T>, key: string, offset: number, trades: T[]): FeedPages<T> {
  if (prev.key === key) {
    const existing = prev.byOffset[offset];
    if (existing && existing.length === trades.length && existing.every((v, i) => v === trades[i])) return prev;
    return { key, byOffset: { ...prev.byOffset, [offset]: trades } };
  }
  return { key, byOffset: { [offset]: trades } };
}

/** offset 오름차순으로 펼친다(더보기 순서 보존). */
export function flattenFeedPages<T>(pages: FeedPages<T>): T[] {
  return Object.keys(pages.byOffset)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((o) => pages.byOffset[o]);
}

/**
 * §16 PERCEIVED PERFORMANCE — 필터를 바꾸는 동안 목록을 비우지 않는다.
 *
 * 새 응답이 오기 전까지는 이전 누적본을 **그대로 보여주되 stale로 표시**한다. 화면이
 * 잠깐 비었다가 다시 차는 깜빡임이 "느리다"는 체감의 큰 부분이었다.
 */
export function resolveVisibleFeed<T>(pages: FeedPages<T>, currentKey: string): { trades: T[]; isStale: boolean } {
  const trades = flattenFeedPages(pages);
  return { trades, isStale: pages.key !== currentKey };
}

export interface DatedTrade { dealDate: string }

/** 날짜별 그룹(최신 날짜 우선). 더보기로 페이지가 늘어도 날짜 헤더가 중복되지 않게 한다. */
export function groupTradesByDate<T extends DatedTrade>(trades: T[]): { date: string; trades: T[] }[] {
  const map = new Map<string, T[]>();
  for (const t of trades) {
    const list = map.get(t.dealDate);
    if (list) list.push(t);
    else map.set(t.dealDate, [t]);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({ date, trades: list }));
}
