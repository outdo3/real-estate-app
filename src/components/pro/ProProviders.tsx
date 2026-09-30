'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';

// REALTOR_PRO_PRIVATE_APP_ISOLATION_V1 — Pro 전용 루트 layout의 클라이언트 공급자.
// 공개 AppProviders와 달리 **로그인 세션만** 공급한다(Header의 로그인 버튼이 useSession을 쓴다).
// 넣지 않는 것: ViewTracker(공개 방문 로그) · GoogleAnalytics · RegionProvider(위치 권한·Kakao 역지오코딩) ·
// 서비스 워커 등록 · 설치 배너. 이유와 규칙: docs/pro/REALTOR_PRO_V1_SECURITY.md §0.
export default function ProProviders({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
