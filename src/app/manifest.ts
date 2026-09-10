import type { MetadataRoute } from 'next';

/**
 * PWA_INSTALL_UX_V1 §3 — Web App Manifest.
 *
 * Next.js App Router가 이 파일을 `/manifest.webmanifest`로 서빙한다.
 * 별도 의존성(next-pwa 등)을 추가하지 않는다.
 *
 * 아이콘은 **이미 있는 브랜드 자산을 그대로** 쓴다(§4) — 이 STEP에서 브랜드를
 * 새로 만들거나 바꾸지 않는다.
 *
 * start_url은 `/`다(§14). 리포트/상세 페이지에서 설치해도 앱은 항상 홈에서
 * 시작한다 — 페이지별 동적 manifest는 canonical route를 흐리고 설치 상태를
 * 예측 불가능하게 만든다. 설치 동작 자체는 사용자를 현재 페이지에서 이동시키지
 * 않으므로 공유 링크 흐름(§13)이 끊기지 않는다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '이집 E-JIP',
    short_name: '이집',
    description: '언제 어디서나 쉽게 부산 아파트 실거래가와 현장 팁을 확인하세요.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#10b981',
    lang: 'ko',
    dir: 'ltr',
    categories: ['finance', 'lifestyle', 'utilities'],
    icons: [
      { src: '/brand/icon/ejip-app-icon-96.png', sizes: '96x96', type: 'image/png' },
      { src: '/brand/icon/ejip-app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon/ejip-app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // maskable은 별도 여백이 있는 자산이 필요하다. 지금 자산으로 maskable을
      // 선언하면 안드로이드에서 아이콘이 잘릴 수 있으므로 선언하지 않는다
      // (설치 요건은 any 아이콘만으로 충족된다).
    ],
  };
}
