import type { Metadata, Viewport } from 'next';
import AppProviders from '@/components/AppProviders';
import { siteConfig, absoluteUrl } from '@/config/site';
import './globals.css';

/**
 * PWA_INSTALL_UX_V1 §2/§3 — 설치 가능 요건.
 * themeColor는 Next 16에서 metadata가 아니라 viewport로 분리돼 있다.
 * viewportFit=cover여야 env(safe-area-inset-*)가 실제 값을 갖는다(§9 safe-area).
 */
export const viewport: Viewport = {
  themeColor: '#10b981',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/** 대표 OG 이미지 경로. 절대 URL은 siteConfig에서 만든다(호스트를 여기 적지 않는다). */
const OG_IMAGE_PATH = '/brand/og/ejip-og-main-1200x630.jpg';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  // /manifest.webmanifest (src/app/manifest.ts가 생성)
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: '이집',
    statusBarStyle: 'default',
  },
  title: '이집',
  description: '언제 어디서나 쉽게 부산 아파트 실거래가와 현장 팁을 확인하세요.',
  icons: {
    icon: [
      { url: '/brand/icon/ejip-favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/brand/icon/ejip-favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/icon/ejip-favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/brand/icon/ejip-app-icon-96.png', sizes: '96x96', type: 'image/png' },
      { url: '/brand/icon/ejip-app-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/brand/icon/ejip-app-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/brand/icon/ejip-app-icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
  // MASTER_COVERAGE_SYNC_APPLY_DOMAIN_OG_FIX_V1 §10 — 예전에는 아래 세 곳(openGraph.url,
  // openGraph.images[0].url, twitter.images[0])이 Vercel 호스트를 **직접 박아두고** 있었다.
  // metadataBase·robots·sitemap은 siteConfig를 거치므로 NEXT_PUBLIC_SITE_URL 하나로
  // 따라오는데, 이 셋만 따라오지 않아 도메인을 바꿔도 공유 카드가 옛 주소를 가리켰다.
  //
  // 이제 전부 siteConfig(=단일 출처)에서 파생한다. 오리진을 정하는 곳은
  // src/config/site.ts의 getBaseUrl() 하나뿐이고, 거기서 NEXT_PUBLIC_SITE_URL →
  // 프로덕션 고정 도메인 → 프리뷰 호스트 → localhost 순으로 결정된다.
  openGraph: {
    title: '이집',
    description: '언제 어디서나 쉽게 부산 아파트 실거래가와 현장 팁을 확인하세요.',
    url: siteConfig.url,
    siteName: '이집',
    images: [
      {
        url: absoluteUrl(OG_IMAGE_PATH),
        width: 1200,
        height: 630,
        alt: '이집 - 복잡한 부동산, 이집으로 쉽게',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '이집',
    description: '언제 어디서나 쉽게 부산 아파트 실거래가와 현장 팁을 확인하세요.',
    images: [absoluteUrl(OG_IMAGE_PATH)],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        {/* PERFORMANCE_V2.1 §12 — 카카오 지도 SDK/로컬 API는 검색창을 처음 쓰거나 지도를
            열 때 반드시 붙는 도메인이다. DNS+TLS 핸드셰이크를 미리 끝내 두면 첫 사용에서
            그 왕복이 사라진다. **SDK 자체를 미리 받지는 않는다**(무거운 스크립트를
            전역 선로드하지 않는다는 §12 요구) — 연결만 미리 연다.
            실제로 쓰이는 두 호스트만 연다: 지도 SDK(dapi)와 타일 서버(t1). */}
        <link rel="preconnect" href="https://dapi.kakao.com" />
        <link rel="preconnect" href="https://t1.daumcdn.net" crossOrigin="anonymous" />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
