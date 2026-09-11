'use client';

import { useState } from 'react';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { installGuideFor } from '@/lib/pwa/install-state';
import { trackEvent } from '@/lib/analytics/trackEvent';
import { InstallGuideSheet } from './InstallBanner';

/**
 * PWA_INSTALL_UX_V1 §12 — MY 페이지의 상시 설치 진입점.
 *
 * 배너와 달리 **쿨다운을 보지 않는다.** 배너를 닫은 사용자도 나중에 여기서 다시
 * 설치할 수 있어야 한다는 것이 §12의 요구다.
 *
 * 이미 설치되어 standalone으로 실행 중이면 설치 동작 대신 상태만 알린다(§11).
 */
export default function InstallEntry({ className }: { className?: string }) {
  const { capability, promptInstall, isStandalone } = usePwaInstall();
  const [guideOpen, setGuideOpen] = useState(false);

  if (isStandalone) {
    return (
      <div className={className} aria-live="polite">
        홈 화면에 설치됨
      </div>
    );
  }

  const guide = installGuideFor(capability);
  // 네이티브 프롬프트도 없고 안내할 방법도 없는 환경(주로 데스크톱 브라우저)에서는
  // 있지도 않은 설치를 권하지 않는다.
  if (capability !== 'PROMPTABLE' && !guide) return null;

  const onClick = async () => {
    if (capability === 'PROMPTABLE') {
      trackEvent('pwa_install_click', { ga: { placement: 'entry' } });
      const outcome = await promptInstall();
      if (outcome === 'accepted') trackEvent('pwa_install_accept', { ga: { placement: 'entry' } });
      else if (outcome === 'dismissed') trackEvent('pwa_install_dismiss', { ga: { placement: 'entry' } });
      else setGuideOpen(true);
      return;
    }
    trackEvent('pwa_install_guide_open', { ga: { placement: 'entry' } });
    setGuideOpen(true);
  };

  return (
    <>
      <button type="button" className={className} onClick={onClick} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}>
        이집 설치
      </button>
      {guideOpen && guide && <InstallGuideSheet guide={guide} onClose={() => setGuideOpen(false)} />}
    </>
  );
}
