'use client';

// PERSONALIZED_SCORE_V1 P2-C/P2-E — 로그인 사용자 본인의 중요도 상태 훅.
// - 비로그인: 요청하지 않고 LOGGED_OUT(세션이 끊기면 캐시를 비운다).
// - 세션 확인 중·조회 중: LOADING.
// - 로그인: 사용자 id로 묶인 탭 메모리 캐시에서 한 번만 조회. MY 저장 시 구독으로 즉시 반영.
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { fitPreferenceCache } from '@/lib/fit-preference-cache';
import type { FitImportance } from '@/lib/fit-importance';
import type { FitPreferenceState } from '@/lib/personal-fit-ui';

export function useFitPreference(): { state: FitPreferenceState; userId: string | null; save: (value: FitImportance | null) => void } {
  const { data: session, status } = useSession();
  const userId = status === 'authenticated' ? session?.user?.id ?? null : null;
  const [, setVersion] = useState(0);
  const [failedFor, setFailedFor] = useState<string | null>(null);

  useEffect(() => fitPreferenceCache.subscribe(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      fitPreferenceCache.clear();
      return;
    }
    if (!userId) return;
    let cancelled = false;
    setFailedFor(null);
    fitPreferenceCache.load(userId).catch(() => {
      if (!cancelled) setFailedFor(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [status, userId]);

  const save = useCallback(
    (value: FitImportance | null) => {
      if (userId) fitPreferenceCache.set(userId, value);
    },
    [userId]
  );

  let state: FitPreferenceState;
  if (status === 'unauthenticated') state = { kind: 'LOGGED_OUT' };
  else if (!userId) state = { kind: 'LOADING' };
  else if (failedFor === userId) state = { kind: 'ERROR' };
  else {
    const cached = fitPreferenceCache.peek(userId);
    state = cached === undefined ? { kind: 'LOADING' } : { kind: 'READY', fitImportance: cached };
  }
  return { state, userId, save };
}
