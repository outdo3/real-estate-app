// PERSONALIZED_SCORE_V1 P2-C/P2-E — 나에게 맞는 점수 화면용 순수 로직(React·네트워크 없음).
//
// 1) MY 중요도 설정 draft: 기본값 없이 5개를 사용자가 모두 골라야 저장 가능.
// 2) 상세 카드 상태 판정: 로그인/설정/공통 점수 상태 + P2-B 계산 결과를 그대로 화면 모델로 옮긴다
//    (점수·GOOD/WEAK 판정을 여기서 다시 하지 않는다).
import { FIT_AXES, FIT_AXIS_LABELS, parseFitImportance, type FitAxis, type FitImportance, type FitImportanceLevel } from './fit-importance';
import { calculatePersonalFit, isCommonScoreAvailable, type PersonalAxisExclusion, type PersonalFitExplanation } from './personalized-score';

export const FIT_SETTINGS_ANCHOR = 'fit-score-settings';
export const FIT_SETTINGS_HREF = `/my#${FIT_SETTINGS_ANCHOR}`;

export const FIT_LEVEL_MEANINGS: Record<FitImportanceLevel, string> = {
  1: '중요하지 않음',
  2: '조금 중요',
  3: '보통',
  4: '중요',
  5: '매우 중요',
};

export const FIT_LEVELS: readonly FitImportanceLevel[] = [1, 2, 3, 4, 5];

export const PERSONAL_FIT_COPY = {
  title: '나에게 맞는 점수',
  subtitle: '내가 중요하게 보는 조건을 반영한 적합도예요',
  badgeFull: '내 중요도 반영',
  badgeLimited: '일부 정보 부족',
  limitedNote: '일부 정보가 없어 확인 가능한 조건만 반영했어요.',
  loggedOut: '로그인하면 나에게 맞는 점수를 확인할 수 있어요',
  loggedOutCta: '로그인하고 확인',
  noSettings: '중요하게 보는 조건을 설정하면 나에게 맞는 점수를 계산해 드려요',
  noSettingsCta: '내 중요도 설정하기',
  unavailable: '현재 이 단지는 나에게 맞는 점수를 계산할 정보가 부족해요.',
  loadError: '내 중요도를 불러오지 못했어요.',
  goodTitle: '잘 맞는 점',
  weakTitle: '아쉬운 점',
  excludedTitle: '반영 제외',
  editLink: '중요도 수정',
  disclaimer: '개인 선호를 반영한 적합도이며, 투자 판단이나 가격 전망을 의미하지 않습니다.',
  settingsTitle: '나에게 맞는 점수 설정',
  settingsDesc: '아파트를 볼 때 중요하게 생각하는 조건을 알려주세요. 이 설정은 나에게 맞는 점수를 계산할 때만 사용됩니다.',
  settingsIncomplete: '5개 항목을 모두 선택하면 저장할 수 있어요.',
  save: '저장하기',
  saving: '저장 중...',
  saved: '저장했어요',
  saveError: '저장하지 못했어요. 다시 시도해 주세요.',
} as const;

// ── MY 설정 draft ──────────────────────────────────────────────────────────────

export type FitImportanceDraft = Record<FitAxis, FitImportanceLevel | null>;

/** 처음 설정: 전부 미선택(기본값 없음). 기존 값이 있으면 그 값. */
export function draftFromSaved(saved: FitImportance | null): FitImportanceDraft {
  return Object.fromEntries(FIT_AXES.map((a) => [a, saved ? saved[a] : null])) as FitImportanceDraft;
}

export function setDraftLevel(draft: FitImportanceDraft, axis: FitAxis, level: FitImportanceLevel): FitImportanceDraft {
  return { ...draft, [axis]: level };
}

/** 5개 모두 선택됐을 때만 저장 가능한 값. */
export function draftToImportance(draft: FitImportanceDraft): FitImportance | null {
  const parsed = parseFitImportance(draft);
  return parsed.ok ? parsed.value : null;
}

export function isDraftDirty(draft: FitImportanceDraft, saved: FitImportance | null): boolean {
  return FIT_AXES.some((a) => draft[a] !== (saved ? saved[a] : null));
}

export function canSaveDraft(draft: FitImportanceDraft, saved: FitImportance | null, saving: boolean): boolean {
  return !saving && draftToImportance(draft) !== null && isDraftDirty(draft, saved);
}

// ── 상세 카드 상태 ─────────────────────────────────────────────────────────────

export type FitPreferenceState =
  | { kind: 'LOGGED_OUT' }
  | { kind: 'LOADING' } // 세션 확인 중 또는 선호 조회 중
  | { kind: 'ERROR' }
  | { kind: 'READY'; fitImportance: FitImportance | null };

export interface PersonalFitAxisRow {
  axis: FitAxis;
  label: string;
  importance: FitImportanceLevel;
  /** 반영된 축만 정수 점수. 제외 축은 null(0으로 보이지 않게). */
  displayScore: number | null;
  excludedText: string | null;
}

export type PersonalFitCardModel =
  | { kind: 'HIDDEN' }
  | { kind: 'PLACEHOLDER' }
  | { kind: 'LOGGED_OUT' }
  | { kind: 'NO_SETTINGS' }
  | { kind: 'UNAVAILABLE' }
  | { kind: 'ERROR' }
  | {
      kind: 'SCORE';
      status: 'FULL' | 'LIMITED';
      score: number;
      rows: PersonalFitAxisRow[];
      excludedTexts: string[];
      goodFit: PersonalFitExplanation[];
      weakFit: PersonalFitExplanation[];
    };

export function exclusionText(axis: FitAxis, exclusion: PersonalAxisExclusion | null): string | null {
  if (!exclusion) return null;
  if (exclusion === 'PARKING_NOT_MEASURED') return '주차 정보 없음';
  if (exclusion === 'INVALID_SCORE') return `${FIT_AXIS_LABELS[axis]} 정보 확인 필요`;
  return `${FIT_AXIS_LABELS[axis]} 정보 없음`;
}

/**
 * 카드에 무엇을 보일지. 공통 점수 응답(scoreLoading/shadowV2)과 선호 상태만 본다.
 * - 공통 점수 로딩 중: 자리만 유지(PLACEHOLDER)
 * - 비로그인: 공통 점수가 있을 때만 로그인 안내(계산할 수 없는 단지에서 로그인을 권하지 않는다)
 * - 로그인·미설정: 설정 안내 / 설정됨: P2-B 결과를 그대로 화면 모델로
 */
export function derivePersonalFitCard(input: { scoreLoading: boolean; shadowV2: unknown; preference: FitPreferenceState }): PersonalFitCardModel {
  const { preference } = input;
  if (input.scoreLoading) return { kind: 'PLACEHOLDER' };
  if (preference.kind === 'LOGGED_OUT') {
    // 계산할 수 없는 단지에서는 로그인을 권하지 않는다. 비로그인은 선호 조회·개인화 계산을 하지 않는다.
    return isCommonScoreAvailable(input.shadowV2) ? { kind: 'LOGGED_OUT' } : { kind: 'HIDDEN' };
  }
  if (preference.kind === 'LOADING') return { kind: 'PLACEHOLDER' };
  if (preference.kind === 'ERROR') return { kind: 'ERROR' };
  if (preference.fitImportance === null) return { kind: 'NO_SETTINGS' };

  const result = calculatePersonalFit({ shadowV2: input.shadowV2, fitImportance: preference.fitImportance });
  if (result.status === 'UNAVAILABLE') return { kind: 'UNAVAILABLE' };
  return {
    kind: 'SCORE',
    status: result.status,
    score: result.score,
    rows: result.axisResults.map((r) => ({
      axis: r.axis,
      label: r.label,
      importance: r.importance,
      displayScore: r.included && r.score != null ? Math.round(r.score) : null,
      excludedText: exclusionText(r.axis, r.exclusion),
    })),
    excludedTexts: result.axisResults.map((r) => exclusionText(r.axis, r.exclusion)).filter((t): t is string => !!t),
    goodFit: result.goodFit,
    weakFit: result.weakFit,
  };
}
