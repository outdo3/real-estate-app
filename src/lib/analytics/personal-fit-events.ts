// PERSONALIZED_SCORE_V1 P2-F — 나에게 맞는 점수 analytics의 순수 판정(React·네트워크 없음).
//
// 화면 모델 → 이벤트 actionType(고정 enum)만 만든다. 중요도 값·점수·coverage 숫자·제외 축·단지 이름/aptSeq는
// 결과에 들어갈 자리가 없다. 로딩·로그인 안내·설정 안내·오류·숨김 상태는 view 이벤트를 만들지 않는다.
import type { ComparePersonalFitModel, PersonalFitCardModel } from '../personal-fit-ui';

export type PersonalFitSourceAction = 'DETAIL' | 'COMPARE';
export type PersonalFitCardViewAction = 'FULL' | 'LIMITED' | 'UNAVAILABLE';
export type PersonalFitCompareViewAction = 'FULL_FULL' | 'FULL_LIMITED' | 'LIMITED_LIMITED' | 'HAS_UNAVAILABLE';

/** 상세 카드가 "결과 상태"로 그려졌을 때만 값. */
export function cardViewAction(model: PersonalFitCardModel): PersonalFitCardViewAction | null {
  if (model.kind === 'SCORE') return model.status;
  if (model.kind === 'UNAVAILABLE') return 'UNAVAILABLE';
  return null;
}

/** 비교 블록이 점수 상태로 그려졌을 때만 값. 한쪽이라도 계산 불가면 HAS_UNAVAILABLE(순서 무관). */
export function compareViewAction(model: ComparePersonalFitModel): PersonalFitCompareViewAction | null {
  if (model.kind !== 'SCORES') return null;
  const sides = [model.a, model.b];
  if (sides.some((s) => s.kind === 'UNAVAILABLE')) return 'HAS_UNAVAILABLE';
  const limited = sides.filter((s) => s.kind === 'SCORE' && s.status === 'LIMITED').length;
  return limited === 0 ? 'FULL_FULL' : limited === 1 ? 'FULL_LIMITED' : 'LIMITED_LIMITED';
}

/**
 * 같은 결과(같은 점수 응답 객체들)에 대해 view를 한 번만 보내기 위한 판정.
 * 리렌더에서는 같은 객체 참조가 유지되므로 다시 보내지 않고, 다른 단지(새 응답 객체)로 바뀌면 다시 보낸다.
 */
export function shouldLogImpression(lastKeys: readonly unknown[] | null, nextKeys: readonly unknown[], action: string | null): boolean {
  if (action === null) return false;
  if (!lastKeys) return true;
  return lastKeys.length !== nextKeys.length || lastKeys.some((k, i) => k !== nextKeys[i]);
}
