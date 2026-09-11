'use client';

import { useEffect } from 'react';
import { loadKakaoShareSdk, ensureKakaoInitialized } from '@/lib/share/shareUtils';

/**
 * SHARE_CARD_UNIFICATION_V1 §3 — 카카오 공유 SDK 선(先)로드.
 *
 * 왜 미리 로드하는가: 클릭 시점에 SDK를 처음 받으면 로드를 기다리는 await 때문에
 * sendDefault() 호출이 더 이상 "사용자가 직접 클릭한 동기 실행 흐름"이 아니게 되고,
 * 브라우저가 그 안의 window.open()을 팝업으로 차단한다. 차단되면 반환값이 null이라
 * 카카오 SDK가 곧바로 .focus()를 호출하다 예외로 조용히 죽는다(실측 확인).
 *
 * 왜 마운트 즉시가 아닌가: PERCEIVED_PERFORMANCE_V2_5 §3 — /map 실측 waterfall에서 이
 * 스크립트는 지도 모듈·첫 타일과 대역폭을 다투는 3.5~6.7초 구간에 걸쳐 받아졌다.
 * 공유 SDK는 첫 화면에 필요하지 않으므로 브라우저가 한가해진 뒤로 미룬다. 사용자가
 * 공유 버튼을 누르기까지는 어떤 경우에도 이보다 오래 걸리므로 위의 성질은 지켜진다.
 *
 * useSharePage(공용 ShareAction)와 ReportActions(리포트 액션바)가 같은 규칙을 쓰도록
 * 훅 하나로 모았다 — 화면마다 로더를 복붙하지 않는다.
 */
export function useKakaoSharePreload(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      loadKakaoShareSdk()
        .then(() => ensureKakaoInitialized())
        .catch(() => {});
    };
    const w =
      typeof window !== 'undefined'
        ? (window as typeof window & {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
            cancelIdleCallback?: (id: number) => void;
          })
        : undefined;
    if (w?.requestIdleCallback) {
      const id = w.requestIdleCallback(start, { timeout: 4000 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const t = setTimeout(start, 2000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [enabled]);
}
