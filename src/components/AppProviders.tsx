'use client';

import React from 'react';
import { RegionProvider } from '@/contexts/RegionContext';

// layout.tsx는 metadata export가 필요한 Server Component라 자체적으로
// 'use client' Provider를 렌더링할 수 없다. 이 얇은 클라이언트 래퍼를 통해
// 지역 선택 전역 상태(RegionProvider)를 앱 전체에 공급한다.
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return <RegionProvider>{children}</RegionProvider>;
}
