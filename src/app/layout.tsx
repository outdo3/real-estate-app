import type { Metadata } from 'next';
import Script from 'next/script';
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
      <head>
        <Script 
          src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=ca05485a3b656a8eca75a33d158f26a4&libraries=services,clusterer,drawing&autoload=false" 
          strategy="beforeInteractive"
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
