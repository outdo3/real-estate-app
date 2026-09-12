// STATS_LOADING_STATE_UX_V1 §2/§5 — 통계 섹션의 상태 우선순위를 **한 곳에서** 정한다.
//
// ── 고친 문제 ───────────────────────────────────────────────────────────────
// 기간/지역을 바꾸면 SWR 키가 바뀌고, 그 순간 `data`는 undefined가 된다. 여러 화면이
// 그 상태를 이렇게 판단했다:
//
//     !data || data.xxx.length === 0  →  "거래가 없어요"
//
// `!data`는 "없다"가 아니라 **"아직 안 왔다"**다. 그래서 조회가 진행 중인데도 빈 상태
// 문구가 먼저 떴다(사용자 보고: "부산 …, 최근 12개월 기간 내 실거래가 없어요"가 잠깐
// 스침). 빈 상태는 **응답이 도착하고 그 결과가 0건일 때만** 말할 수 있다.
//
// 이 모듈은 계산도 조회도 하지 않는다 — 어떤 UI를 보여줄지만 정한다.

export type StatsViewState = 'loading' | 'error' | 'empty' | 'success';

export interface StatsViewInput {
  /** 현재 조건의 응답이 도착했는가. (SWR의 `data !== undefined`) */
  hasResponse: boolean;
  /** 조회가 진행 중인가. (SWR의 `isLoading`) */
  isFetching: boolean;
  /** 네트워크 실패 또는 응답이 오류 상태인가. */
  hasError: boolean;
  /** 응답이 도착했다는 전제에서, 결과가 0건인가. */
  isEmptyResult: boolean;
}

/**
 * §2 — 우선순위: loading → error → empty → success.
 *
 * 핵심 규칙 두 개:
 *  1. 오류는 로딩보다 먼저 판단한다 — 실패한 조회를 "불러오는 중"으로 붙잡아 두면
 *     무한 스피너가 된다.
 *  2. **응답이 없으면 절대 empty가 아니다.** 조회 중이 아니어도(예: 아직 시작 전)
 *     응답이 없으면 로딩으로 본다 — 모르는 상태를 "없음"으로 단정하지 않는다.
 */
export function resolveStatsViewState(input: StatsViewInput): StatsViewState {
  if (input.hasError) return 'error';
  if (!input.hasResponse || input.isFetching) return 'loading';
  return input.isEmptyResult ? 'empty' : 'success';
}

/**
 * §5 — "지금 빈 상태를 말해도 되는가."
 *
 * 화면 구조를 크게 바꾸지 않고 기존 삼항 분기에 끼워 넣을 수 있도록 분리했다.
 * `!data || length === 0` 대신 이 함수를 통과한 뒤에만 빈 상태를 렌더한다.
 */
export function canShowStatsEmpty(input: Omit<StatsViewInput, 'isEmptyResult'>): boolean {
  return resolveStatsViewState({ ...input, isEmptyResult: true }) === 'empty';
}
