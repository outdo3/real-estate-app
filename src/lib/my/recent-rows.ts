// LOGIN_RECENT_VIEWED_DENSITY_V1 §2/§3 — MY(로그인) 화면의 "최근 본 단지" 목록에서
// **몇 줄을 보여줄지**만 정하는 순수 로직.
//
// 여기에 없는 것: 어떤 항목을 보여줄지에 대한 판단. 정렬(viewedAt desc), 중복 제거,
// 보관 개수(API take: 20), canonical 식별자, 클릭 목적지는 전부 이 파일 바깥에서 이미
// 끝나 있고 이 STEP에서 하나도 바뀌지 않는다(§4). 이 모듈은 이미 확정된 목록을
// **앞에서부터 자를 뿐**이다.
//
// apt-detail의 trade-rows.ts와 모양이 비슷하지만 **펼치는 방식이 다르다.** 실거래는
// 15씩 단계적으로 늘리고(거래가 수백 건일 수 있다), 최근 본 단지는 한 번에 전부
// 펼친다(서버가 이미 20개로 잘라 보내므로 "전부"의 상한이 정해져 있다). 규칙이 다르니
// 억지로 한 모듈로 합치지 않는다.

/** 접힌 기본 상태에서 보여줄 행 수(§2). */
export const RECENT_ROWS_COLLAPSED = 5;

/**
 * 화면에 보일 항목.
 *
 * 펼친 상태에서는 **현재 가지고 있는 전부**를 보여준다(§3). 새로 조회하지 않는다 —
 * 목록은 이미 클라이언트 상태에 다 들어와 있다.
 */
export function visibleRecentItems<T>(items: readonly T[], expanded: boolean): T[] {
  return expanded ? [...items] : items.slice(0, RECENT_ROWS_COLLAPSED);
}

/** 접힌 상태에서 더 볼 항목이 남아 있는가. 5개 이하이면 "더보기"를 만들지 않는다(§3). */
export function canExpandRecent(total: number): boolean {
  return total > RECENT_ROWS_COLLAPSED;
}

/**
 * "접기"를 보여줄 상태인가.
 *
 * 펼쳐져 있고, 실제로 접을 게 있을 때만. 항목이 5개 이하인데 펼침 상태가 되면(있을 수
 * 없지만 방어) 접기 버튼이 홀로 남는 일이 없도록 한다.
 */
export function canCollapseRecent(total: number, expanded: boolean): boolean {
  return expanded && canExpandRecent(total);
}
