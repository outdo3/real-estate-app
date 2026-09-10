'use client';

import { useEffect } from 'react';

/**
 * PWA_INSTALL_UX_V1 — 서비스 워커 등록.
 *
 * 렌더링하는 것이 없다. 로드 직후가 아니라 idle에 등록해 첫 화면 렌더와 경쟁하지
 * 않게 한다(§19 — 설치 UX가 초기 로딩을 무겁게 만들면 안 된다).
 */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // 개발 중에는 등록하지 않는다 — HMR과 섞이면 디버깅이 어려워진다.
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* 등록 실패는 치명적이지 않다 — 앱은 그대로 동작하고 설치만 불가능해진다. */
      });
    };

    const w = window as Window & typeof globalThis;
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(register, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(register, 2000);
    return () => clearTimeout(t);
  }, []);

  return null;
}
