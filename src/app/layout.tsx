import type { Metadata } from 'next';
import AppProviders from '@/components/AppProviders';
import './globals.css';

export const metadata: Metadata = {
  title: '아파트써처 - 실거래가 조회, 시세 분석, 학군',
  description: '전국 아파트 실거래가, 시세 변동 추이, 시장 분석, 학군 정보를 한눈에 확인하세요.',
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
