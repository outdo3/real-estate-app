/**
 * APT_DETAIL_MOBILE_DENSITY_ACTION_BAR_V1 §10/§14 — 하단 액션바 노출 판정.
 *
 * ── 왜 순수 함수로 빼나 ────────────────────────────────────────────────────
 * "언제 뜨는가"는 스크롤 이벤트 안에 묻어두면 검증할 방법이 없다. 특히 히스테리시스는
 * 값 하나가 아니라 **이전 상태에 따라 답이 달라지는** 규칙이라, 눈으로 보고 확인하기
 * 어렵고 잘못 고치기는 쉽다. 여기에는 DOM도 React도 없다.
 *
 * ── 의미 ───────────────────────────────────────────────────────────────────
 * 이 바는 "스크롤을 조금 내렸으니 버튼을 보여준다"가 아니다. **정보를 충분히 본 뒤에
 * 행동을 제안한다**는 뜻이다. 그래서 기준이 픽셀이 아니라 문서 진행률이다.
 */

/** 이 이상 내려가면 나타난다. */
export const SHOW_AT_PROGRESS = 0.78;
/** 이 이하로 다시 올라가야 사라진다. */
export const HIDE_AT_PROGRESS = 0.6;

/**
 * 문서 진행률 0~1.
 *
 * 스크롤할 것이 없으면(페이지가 화면보다 짧거나 같으면) **1을 돌려준다**.
 * 그 경우 사용자는 이미 전부 본 것이라 바를 숨겨둘 이유가 없다 — 영영 나타나지
 * 않는 CTA가 되는 것이 더 이상한 동작이다(§15).
 */
export function scrollProgress(scrollY: number, viewportHeight: number, documentHeight: number): number {
  const scrollable = documentHeight - viewportHeight;
  if (!Number.isFinite(scrollable) || scrollable <= 0) return 1;
  const raw = scrollY / scrollable;
  if (!Number.isFinite(raw)) return 1;
  return Math.min(1, Math.max(0, raw));
}

/**
 * 다음 노출 상태. **현재 상태를 함께 받는 것이 핵심**이다.
 *
 * 임계값이 하나면 그 경계에서 손가락이 몇 픽셀만 흔들려도 바가 깜빡인다.
 * 나타나는 기준(78%)과 사라지는 기준(60%)을 벌려 두면, 한 번 뜬 뒤에는 사용자가
 * **의도적으로 위로 되돌아갈 때만** 사라진다.
 */
export function nextActionBarVisibility(progress: number, currentlyVisible: boolean): boolean {
  if (currentlyVisible) return progress > HIDE_AT_PROGRESS;
  return progress >= SHOW_AT_PROGRESS;
}

/** 위 둘을 합친 편의 함수. 호출부(스크롤 핸들러)가 쓰는 형태. */
export function shouldShowActionBar(
  scrollY: number,
  viewportHeight: number,
  documentHeight: number,
  currentlyVisible: boolean
): boolean {
  return nextActionBarVisibility(scrollProgress(scrollY, viewportHeight, documentHeight), currentlyVisible);
}
