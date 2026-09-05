import type { Metadata } from 'next';
import AppProviders from '@/components/AppProviders';
import { siteConfig } from '@/config/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
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
  openGraph: {
    title: '이집',
    description: '언제 어디서나 쉽게 부산 아파트 실거래가와 현장 팁을 확인하세요.',
    url: 'https://real-estate-app-park11.vercel.app',
    siteName: '이집',
    images: [
      {
        url: 'https://real-estate-app-park11.vercel.app/brand/og/ejip-og-main-1200x630.jpg',
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
    images: ['https://real-estate-app-park11.vercel.app/brand/og/ejip-og-main-1200x630.jpg'],
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
