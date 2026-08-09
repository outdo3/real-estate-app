import type { Metadata } from 'next';
import AppProviders from '@/components/AppProviders';
import { siteConfig } from '@/config/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: `${siteConfig.name} - 실거래가 조회, 시세 분석, 학군`,
  description: siteConfig.description,
  openGraph: {
    title: `${siteConfig.name} - 실거래가 조회, 시세 분석, 학군`,
    description: siteConfig.description,
    siteName: siteConfig.name,
    locale: 'ko_KR',
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
