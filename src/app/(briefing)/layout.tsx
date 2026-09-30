import type { Metadata, Viewport } from 'next';
import '../globals.css';

/**
 * REALTOR_PRO_PRIVATE_APP_ISOLATION_V1 — 고객 브리핑(/b/<token>) 전용 **루트** layout (app/(briefing)/layout.tsx).
 *
 * URL 자체가 열람 권한인 화면이다. 공개 화면·Pro와 루트 layout이 달라 항상 새 문서로 열리고,
 * 이 layout은 **어떤 공급자·스크립트도 싣지 않는다**(세션 조회·방문 로그·광고·분석·위치 조회 없음).
 * 메타데이터는 페이지(briefing-page-policy.ts), 응답 헤더(CSP·no-referrer·noindex)는 next.config.ts.
 */

export const viewport: Viewport = {
  themeColor: '#10b981',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
  icons: { icon: [{ url: '/brand/icon/ejip-favicon-32.png', sizes: '32x32', type: 'image/png' }] },
};

export default function BriefingRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
