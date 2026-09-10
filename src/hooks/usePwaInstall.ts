'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canOfferInstall,
  DISMISS_COOLDOWN_MS,
  DISMISS_STORAGE_KEY,
  isMobileEnv,
  resolveInstallCapability,
  shouldShowBanner,
  type InstallCapability,
} from '@/lib/pwa/install-state';

/**
 * PWA_INSTALL_UX_V1 §5/§6 — 설치 상태와 동작을 제공하는 **유일한** 훅.
 *
 * beforeinstallprompt는 페이지 로드 직후 한 번만 발생할 수 있으므로 여기서 잡아
 * 보관한다. 잡지 못하면 네이티브 설치를 할 수 없다는 뜻이고, 그때는 안내로 내려간다
 * (있지도 않은 원탭 설치를 있다고 말하지 않는다).
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaInstallState {
  capability: InstallCapability;
  /** 배너를 실제로 그려도 되는가(모바일 + 미설치 + 쿨다운 통과 + 안내 가능). */
  shouldShowBanner: boolean;
  /** 네이티브 프롬프트를 띄운다. 성공 여부를 돌려준다. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** 배너를 닫고 쿨다운을 기록한다. */
  dismiss: () => void;
  /** MY 페이지처럼 항상 보이는 진입점에서 쓰는 값(쿨다운과 무관). */
  isStandalone: boolean;
  isMobile: boolean;
}

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISS_STORAGE_KEY);
  } catch {
    // 사생활 보호 모드 등에서 접근이 막힐 수 있다 — 그때는 "닫은 적 없음"으로 본다.
    return null;
  }
}

export function usePwaInstall(): PwaInstallState {
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [capability, setCapability] = useState<InstallCapability>('UNSUPPORTED');
  const [isMobile, setIsMobile] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [cooldownPassed, setCooldownPassed] = useState(false);
  const [dismissedNow, setDismissedNow] = useState(false);

  const evaluate = useCallback(() => {
    if (typeof window === 'undefined') return;
    const displayStandalone =
      typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
    const navigatorStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    const env = {
      userAgent: window.navigator.userAgent || '',
      displayStandalone,
      navigatorStandalone,
      hasPrompt: promptRef.current !== null,
      isNarrow: window.innerWidth <= 768,
    };
    setCapability(resolveInstallCapability(env));
    setIsMobile(isMobileEnv(env));
    setStandalone(displayStandalone || navigatorStandalone);
    setCooldownPassed(shouldShowBanner(readDismissed(), Date.now()));
  }, []);

  useEffect(() => {
    evaluate();

    const onBeforeInstallPrompt = (e: Event) => {
      // 기본 미니 인포바를 막고 우리 배너에서 시점을 통제한다.
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
      evaluate();
    };
    const onInstalled = () => {
      promptRef.current = null;
      evaluate();
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // 설치 후 display-mode가 바뀌는 것을 즉시 반영한다(§11).
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
    mq?.addEventListener?.('change', evaluate);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', evaluate);
    };
  }, [evaluate]);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const evt = promptRef.current;
    if (!evt) return 'unavailable';
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      // prompt는 한 번만 쓸 수 있다 — 소비했으면 버린다.
      promptRef.current = null;
      if (outcome === 'dismissed') {
        // 네이티브 프롬프트를 거절한 것도 거절이다 — 쿨다운을 건다(§6 "반복해서 조르지 않는다").
        try {
          window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
        } catch {
          /* 저장 실패는 조용히 무시 — 기능이 막히면 안 된다. */
        }
        setDismissedNow(true);
      }
      evaluate();
      return outcome;
    } catch {
      promptRef.current = null;
      evaluate();
      return 'unavailable';
    }
  }, [evaluate]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      /* 저장이 막혀도 이번 세션에서는 닫힌 상태를 유지한다. */
    }
    setDismissedNow(true);
  }, []);

  return {
    capability,
    shouldShowBanner:
      !dismissedNow && isMobile && !standalone && cooldownPassed && canOfferInstall(capability),
    promptInstall,
    dismiss,
    isStandalone: standalone,
    isMobile,
  };
}

export { DISMISS_COOLDOWN_MS };
