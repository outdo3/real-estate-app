import type { Metadata, Viewport } from 'next';
import ProProviders from '@/components/pro/ProProviders';
import { siteConfig } from '@/config/site';
import '../globals.css';

/**
 * REALTOR_PRO_PRIVATE_APP_ISOLATION_V1 — 중개사 Pro 전용 **루트** layout (app/(pro)/layout.tsx).
 *
 * 공개 화면(app/(public)/layout.tsx)과 루트 layout이 다르므로, 공개 화면 ↔ /pro 이동은 Next가 항상
 * **전체 문서 로드**로 처리한다(route-groups 문서 "Full page load"). 그래서 공개 화면에서 이미 실행된
 * 광고·분석 스크립트가 /pro 문서로 넘어오지 않는다 — 조건부 렌더링이 아니라 문서 경계로 막는다.
 *
 * 이 layout에 두지 않는 것: AdSense · GA4 · 공개 방문 로그(ViewTracker) · 위치 조회(RegionProvider) ·
 * Kakao preconnect · 서비스 워커 등록 · 설치 배너. 새 스크립트는 privacy zone을 선언해야 한다
 * (src/lib/privacy/private-routes.ts, docs/pro/REALTOR_PRO_V1_SECURITY.md §0).
 * 응답 헤더(noindex·no-referrer·frame 차단)는 next.config.ts가 /pro, /pro/*에 건다.
 */

export const viewport: Viewport = {
  themeColor: '#10b981',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: '이집 중개사 Pro',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
  icons: {
    icon: [{ url: '/brand/icon/ejip-favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: [{ url: '/brand/icon/ejip-app-icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function ProRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <ProProviders>{children}</ProProviders>
      </body>
    </html>
  );
}
