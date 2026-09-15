'use client';

// PERSONALIZED_SCORE_V1 P2-F — 개인화 이벤트 전송의 유일한 입구.
//
// 시그니처가 곧 개인정보 경계다: 이벤트 이름과 그 이벤트의 고정 enum 값(위치/상태) 하나만 받는다.
// 중요도·점수·coverage·단지 이름/aptSeq를 넘길 인자가 없다. 전송 실패(스토리지 차단 등)는 삼켜
// 개인화 화면을 절대 깨뜨리지 않는다(fire-and-forget).
import { trackEvent } from './trackEvent';
import type { PERSONAL_FIT_EVENT_ACTIONS, PersonalFitEventName } from './events';

type ActionOf<N extends PersonalFitEventName> = (typeof PERSONAL_FIT_EVENT_ACTIONS)[N][number];

export function trackPersonalFit<N extends PersonalFitEventName>(name: N, ...action: ActionOf<N> extends never ? [] : [ActionOf<N>]): void {
  try {
    trackEvent(name, action.length ? { actionType: action[0] } : {});
  } catch {
    // 분석 실패는 제품 동작에 영향을 주지 않는다.
  }
}
