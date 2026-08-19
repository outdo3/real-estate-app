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
        url: 'https://real-estate-app-park11.vercel.app/og-image.png',
        width: 1200,
        height: 630,
        alt: '이집 메인 이미지',
      },
    ],
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
