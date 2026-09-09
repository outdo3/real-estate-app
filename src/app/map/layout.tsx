import type { ReactNode } from 'react';
import { kakaoMapsSdkUrl } from '@/lib/kakao/maps-sdk';

// PERCEIVED_PERFORMANCE_V2_2 §5 — 지도 라우트에서만 Kakao 지도 SDK를 미리 받아둔다.
//
// 실측한 BEFORE 파이프라인(Production, 4G/4x CPU, n=4):
//   FCP 608ms → sdk.js 요청 시작 **1,133ms** → 다운로드 완료 1,258ms → SDK ready 1,488ms
// 다운로드는 125ms밖에 안 걸린다(root layout의 preconnect 덕). 1,133ms는 순수하게
// "hydration이 끝나고 effect가 돌아 로더가 스크립트를 주입할 때까지"의 대기다.
//
// preload는 스크립트를 **실행하지 않고 받아만 둔다** — 실행 시점과 `kakao.maps.load()`
// 호출은 여전히 loadKakaoMapsSdk()가 통제하므로 초기화 순서/중복 방지 로직은 그대로다.
// URL은 로더와 같은 함수(kakaoMapsSdkUrl)로 만들어 두 번 받는 일이 없게 한다.
//
// 이 layout은 `/map` 하위에만 적용된다 — 지도를 쓰지 않는 화면에서 SDK를 내려받지 않는다.
export default function MapLayout({ children }: { children: ReactNode }) {
  const sdkUrl = kakaoMapsSdkUrl();
  return (
    <>
      {sdkUrl && <link rel="preload" as="script" href={sdkUrl} />}
      {children}
    </>
  );
}
