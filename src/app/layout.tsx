import type { Metadata } from 'next';
import AppProviders from '@/components/AppProviders';
import { siteConfig } from '@/config/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: '이집 - 부산 실거래가 지도',
  description: '언제 어디서나 쉽게 부산 아파트 실거래가와 현장 팁을 확인하세요.',
  openGraph: {
    title: '이집 - 부산 실거래가 지도',
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
