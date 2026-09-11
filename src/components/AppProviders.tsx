'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { RegionProvider } from '@/contexts/RegionContext';
import ViewTracker from '@/components/ViewTracker';
import RegisterServiceWorker from '@/components/pwa/RegisterServiceWorker';
import InstallBanner from '@/components/pwa/InstallBanner';
import GoogleAnalytics from '@/components/analytics/GoogleAnalytics';

// layout.tsx는 metadata export가 필요한 Server Component라 자체적으로
// 'use client' Provider를 렌더링할 수 없다. 이 얇은 클라이언트 래퍼를 통해
// 지역 선택 전역 상태(RegionProvider)와 로그인 세션(SessionProvider)을
// 앱 전체에 공급한다. ViewTracker(방문 로그+하트비트)도 여기서 앱 전체에 한 번만
// 마운트한다.
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <RegionProvider>
        <ViewTracker />
        {/* GA4_INTEGRATION_V1 — 마케팅/유입 분석(2차 레이어). 반드시 ViewTracker
            **다음에** 둔다: ViewTracker의 마운트 effect가 QA suppression 플래그를
            먼저 확정해야 GA4가 같은 기준으로 운영자/QA 트래픽을 제외한다.
            Measurement ID가 없으면 아무것도 렌더하지 않는다. */}
        <GoogleAnalytics />
        {/* PWA_INSTALL_UX_V1 — 앱 전체에 한 번만 마운트한다. 배너는 스스로
            "모바일 + 미설치 + 쿨다운 통과"일 때만 렌더한다. */}
        <RegisterServiceWorker />
        {children}
        <InstallBanner />
      </RegionProvider>
    </SessionProvider>
  );
}
