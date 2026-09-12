// CONDITIONAL_HOME_FIND_UI_HIDE_V1 — 사용자에게 보일 진입점을 켜고 끄는 **단일 지점**.
//
// ── 이 파일이 하는 일 / 하지 않는 일 ───────────────────────────────────────
// 하는 일 : 화면에 진입점(버튼·메뉴·탭)을 렌더할지 말지만 정한다.
// 안 하는 일: 라우트·API·컴포넌트·검색/추천 로직을 비활성화하지 않는다. 기능은 그대로
//            살아 있고 직접 URL로 접근하면 정상 동작한다(내부 테스트·QA용).
//
// 왜 CSS로 숨기지 않는가: `display: none`을 화면마다 흩뿌리면 어디가 숨겨졌는지 아무도
// 모르게 되고, 다시 켤 때 빠뜨린 자리가 남는다. 숨김 여부를 여기 한 곳에 두면 **상수
// 하나만 바꿔 되돌릴 수 있다.**
//
// 왜 환경변수가 아닌가: 클라이언트에서 읽는 값은 `NEXT_PUBLIC_*`이라도 빌드 타임에
// 구워지므로, 환경변수로 만들어도 되돌리려면 결국 재배포가 필요하다. 그렇다면 값이
// 코드에 있고 리뷰·git 이력에 남는 편이 낫다(누가 언제 왜 껐는지 추적 가능).

export interface FeatureFlags {
  /**
   * '조건으로 집 찾기'(`/ai-search`)의 **사용자 진입점** 노출 여부.
   *
   * 부산 소프트런칭 동안 false. 기능 자체를 끄는 스위치가 아니다 —
   * `/ai-search` 라우트와 `/api/ai-search`는 계속 살아 있고, 직접 URL로 들어가면
   * 그대로 쓸 수 있다. 홈의 퀵액션 버튼만 렌더되지 않는다.
   *
   * 다시 켜는 방법: **이 값을 true로 바꾸고 배포한다.** 그 외에 손댈 곳은 없다.
   */
  conditionalHomeFindEntry: boolean;
}

export const FEATURE_FLAGS: FeatureFlags = {
  conditionalHomeFindEntry: false,
};

/** 진입점을 렌더해도 되는가. 호출부는 이 함수만 보고 판단한다. */
export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  return FEATURE_FLAGS[flag];
}
