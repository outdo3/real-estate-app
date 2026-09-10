'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { installGuideFor } from '@/lib/pwa/install-state';
import { trackEvent } from '@/lib/analytics/trackEvent';
import styles from './InstallBanner.module.css';

/**
 * PWA_INSTALL_UX_V1 §9 — 첫 방문 설치 배너.
 *
 * 카카오톡으로 받은 리포트 링크를 열었을 때가 주 시나리오다(§13). 그래서 배너는
 * **내용을 가리지 않는다**: 화면 하단에 얇게 붙고, 이미 있는 하단 바(탭바 또는
 * 리포트 액션바) **위로** 올라앉는다.
 *
 * 하단 바 높이는 하드코딩하지 않고 런타임에 잰다. 라우트마다 다르기 때문이다:
 *   /report 허브 · 일반 화면  → BottomNav (60px + safe-area)
 *   리포트 시트 화면          → 액션바 (버튼 높이 + safe-area), BottomNav 없음
 * 두 컨테이너 모두 `data-bottom-bar` 속성을 갖고, 여기서 그중 가장 높은 것을 피한다.
 */
export default function InstallBanner() {
  const { capability, shouldShowBanner, promptInstall, dismiss } = usePwaInstall();
  const [guideOpen, setGuideOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [viewed, setViewed] = useState(false);

  // 하단 고정 바를 피할 만큼의 여백을 실측한다.
  const measure = useCallback(() => {
    if (typeof document === 'undefined') return;
    const bars = Array.from(document.querySelectorAll<HTMLElement>('[data-bottom-bar]'));
    let max = 0;
    for (const bar of bars) {
      const rect = bar.getBoundingClientRect();
      // 화면 하단에 실제로 붙어 있고 보이는 것만 센다.
      if (rect.height > 0 && rect.bottom >= window.innerHeight - 2) {
        max = Math.max(max, rect.height);
      }
    }
    setOffset(max);
  }, []);

  useEffect(() => {
    if (!shouldShowBanner) return;
    measure();
    window.addEventListener('resize', measure);
    // 라우트 전환 후 하단 바가 바뀔 수 있어 한 번 더 잰다.
    const t = setTimeout(measure, 400);
    return () => {
      window.removeEventListener('resize', measure);
      clearTimeout(t);
    };
  }, [shouldShowBanner, measure]);

  useEffect(() => {
    if (shouldShowBanner && !viewed) {
      setViewed(true);
      trackEvent('pwa_install_banner_view');
    }
  }, [shouldShowBanner, viewed]);

  if (!shouldShowBanner) return null;

  const guide = installGuideFor(capability);
  const canPromptNatively = capability === 'PROMPTABLE';

  const onInstall = async () => {
    trackEvent('pwa_install_click');
    const outcome = await promptInstall();
    if (outcome === 'accepted') trackEvent('pwa_install_accept');
    else if (outcome === 'dismissed') trackEvent('pwa_install_dismiss');
    else setGuideOpen(true); // 프롬프트가 사라졌으면 안내로 내려간다(거짓 성공 금지).
  };

  const onGuide = () => {
    trackEvent('pwa_install_guide_open');
    setGuideOpen(true);
  };

  return (
    <>
      {/* data-export-exclude: 리포트를 인쇄/캡처할 때 설치 배너가 문서에 남지
          않게 한다(REPORT-6 §12의 단일 계약). */}
      <div
        className={styles.banner}
        style={{ bottom: `calc(${offset}px + 8px)` }}
        role="region"
        aria-label="홈 화면에 추가 안내"
        data-export-exclude=""
      >
        <div className={styles.text}>
          <span className={styles.title}>이집을 홈 화면에 추가하고 바로 확인하세요</span>
        </div>
        <div className={styles.actions}>
          {canPromptNatively ? (
            <button type="button" className={styles.primary} onClick={onInstall}>
              <Download size={15} aria-hidden="true" />
              설치하기
            </button>
          ) : (
            <button type="button" className={styles.primary} onClick={onGuide}>
              <Share size={15} aria-hidden="true" />
              설치 방법 보기
            </button>
          )}
          <button type="button" className={styles.close} onClick={dismiss} aria-label="설치 안내 닫기">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {guideOpen && guide && <InstallGuideSheet guide={guide} onClose={() => setGuideOpen(false)} />}
    </>
  );
}

/** §7/§8 — 짧은 안내 시트. 튜토리얼 페이지를 만들지 않는다. */
export function InstallGuideSheet({
  guide,
  onClose,
}: {
  guide: { title: string; steps: string[] };
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation" data-export-exclude="">
      <div
        className={styles.sheet}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="홈 화면에 추가하는 방법"
      >
        <p className={styles.sheetTitle}>{guide.title}</p>
        <ol className={styles.steps}>
          {guide.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <button type="button" className={styles.sheetClose} onClick={onClose}>
          확인
        </button>
      </div>
    </div>
  );
}
