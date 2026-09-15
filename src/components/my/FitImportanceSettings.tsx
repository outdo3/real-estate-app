'use client';

// PERSONALIZED_SCORE_V1 P2-E — MY "나에게 맞는 점수 설정".
//
// 5개 축 × 중요도 1~5. 처음에는 **아무것도 선택되지 않은 상태**(기본값 없음)이고, 5개를 모두 고르고
// 저장된 값과 달라졌을 때만 저장할 수 있다. 저장은 fitImportance만 보내 관심 목적(purposes)은 그대로 둔다.
// 성공하면 탭 메모리 캐시를 갱신해 상세페이지가 새로고침 없이 새 값을 쓴다. 실패하면 저장된 값을 유지한다.
// 중요도 값은 analytics·URL·로그로 보내지 않는다.
import React, { useEffect, useRef, useState } from 'react';
import { FIT_AXES, FIT_AXIS_LABELS, readStoredFitImportance, type FitImportance } from '@/lib/fit-importance';
import {
  FIT_LEVELS,
  FIT_LEVEL_MEANINGS,
  FIT_SETTINGS_ANCHOR,
  PERSONAL_FIT_COPY as COPY,
  canSaveDraft,
  draftFromSaved,
  draftToImportance,
  setDraftLevel,
  type FitImportanceDraft,
} from '@/lib/personal-fit-ui';
import { useFitPreference } from '@/hooks/useFitPreference';
import styles from './FitImportanceSettings.module.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function FitImportanceSettings() {
  const { state, save: updateCache } = useFitPreference();
  const saved: FitImportance | null = state.kind === 'READY' ? state.fitImportance : null;
  const [draft, setDraft] = useState<FitImportanceDraft>(() => draftFromSaved(null));
  const [initialized, setInitialized] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const sectionRef = useRef<HTMLElement | null>(null);

  // 저장된 값을 처음 받았을 때 한 번만 draft로 채운다(사용자가 고르는 중에 덮어쓰지 않는다).
  useEffect(() => {
    if (state.kind !== 'READY' || initialized) return;
    setDraft(draftFromSaved(state.fitImportance));
    setInitialized(true);
  }, [state, initialized]);

  // 상세페이지의 "내 중요도 설정하기 / 중요도 수정" 링크(#fit-score-settings)로 들어오면 섹션으로 스크롤.
  // MY 본문은 세션 확인 뒤에 그려져 브라우저 기본 앵커 이동이 동작하지 않기 때문이다.
  useEffect(() => {
    if (!initialized || typeof window === 'undefined') return;
    if (window.location.hash === `#${FIT_SETTINGS_ANCHOR}`) sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [initialized]);

  const complete = draftToImportance(draft) !== null;
  const canSave = initialized && canSaveDraft(draft, saved, saveState === 'saving');

  const handleSave = async () => {
    const value = draftToImportance(draft);
    if (!value || !canSave) return;
    setSaveState('saving');
    try {
      const res = await fetch('/api/my/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fitImportance: value }),
      });
      const json = (await res.json().catch(() => null)) as { success?: boolean; data?: { fitImportance?: unknown } } | null;
      if (!res.ok || !json?.success) throw new Error('save failed');
      const stored = readStoredFitImportance(json.data?.fitImportance ?? null);
      updateCache(stored);
      setDraft(draftFromSaved(stored));
      setSaveState('saved');
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 3000);
    } catch {
      setSaveState('error');
    }
  };

  return (
    <section id={FIT_SETTINGS_ANCHOR} ref={sectionRef} className={styles.section} aria-labelledby="fit-settings-title">
      <h2 id="fit-settings-title" className={styles.title}>
        {COPY.settingsTitle}
      </h2>
      <p className={styles.desc}>{COPY.settingsDesc}</p>

      {state.kind === 'ERROR' ? (
        <p className={styles.loadError}>{COPY.loadError}</p>
      ) : !initialized ? (
        <div className={styles.loading}>불러오는 중입니다...</div>
      ) : (
        <>
          <ul className={styles.axisList}>
            {FIT_AXES.map((axis) => {
              const selected = draft[axis];
              const labelId = `fit-axis-${axis}`;
              return (
                <li key={axis} className={styles.axisItem}>
                  <div className={styles.axisHeader}>
                    <span id={labelId} className={styles.axisLabel}>
                      {FIT_AXIS_LABELS[axis]}
                    </span>
                    <span className={`${styles.meaning} ${selected == null ? styles.meaningEmpty : ''}`} aria-live="polite">
                      {selected == null ? '선택 안 함' : FIT_LEVEL_MEANINGS[selected]}
                    </span>
                  </div>
                  <div className={styles.levels} role="radiogroup" aria-labelledby={labelId}>
                    {FIT_LEVELS.map((level) => {
                      const active = selected === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={`${FIT_AXIS_LABELS[axis]} 중요도 ${level} (${FIT_LEVEL_MEANINGS[level]})`}
                          className={`${styles.level} ${active ? styles.levelActive : ''}`}
                          onClick={() => {
                            setDraft((d) => setDraftLevel(d, axis, level));
                            if (saveState !== 'saving') setSaveState('idle');
                          }}
                        >
                          {level}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className={styles.footer}>
            <button type="button" className={styles.saveButton} onClick={handleSave} disabled={!canSave}>
              {saveState === 'saving' ? COPY.saving : COPY.save}
            </button>
            <div className={styles.status} aria-live="polite">
              {saveState === 'saved' && <span className={styles.saved}>{COPY.saved}</span>}
              {saveState === 'error' && <span className={styles.error}>{COPY.saveError}</span>}
              {saveState === 'idle' && !complete && <span className={styles.hint}>{COPY.settingsIncomplete}</span>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
