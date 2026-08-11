'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { RegionProvider } from '@/contexts/RegionContext';
import ViewTracker from '@/components/ViewTracker';

// layout.tsx는 metadata export가 필요한 Server Component라 자체적으로
// 'use client' Provider를 렌더링할 수 없다. 이 얇은 클라이언트 래퍼를 통해
// 지역 선택 전역 상태(RegionProvider)와 로그인 세션(SessionProvider)을
// 앱 전체에 공급한다. ViewTracker(방문 로그+하트비트)도 여기서 앱 전체에 한 번만
// 마운트한다.
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <RegionProvider>
        <ViewTracker />
        {children}
      </RegionProvider>
    </SessionProvider>
  );
}
