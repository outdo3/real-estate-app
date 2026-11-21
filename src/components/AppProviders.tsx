'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { RegionProvider } from '@/contexts/RegionContext';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider session={null} refetchOnWindowFocus={false}>
      <RegionProvider>
        <aside style={{ padding: '8px 12px', background: '#fff3c4', color: '#392800', fontSize: 13 }}>
          격리 QA · 2026-11-20~21 보존 공개 응답 · 지도 마커는 광안자이 1개 표본 · 실시간 DB 연결 없음
        </aside>
        {children}
      </RegionProvider>
    </SessionProvider>
  );
}
