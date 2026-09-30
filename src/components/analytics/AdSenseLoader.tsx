'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { ADSENSE_SCRIPT_SRC } from '@/lib/adsense';
import { isAdFreePath } from '@/lib/privacy/private-routes';

/**
 * ADSENSE_CONNECTION_V1 — 사이트 소유권 확인용 공식 로더(광고 슬롯·Auto Ads 없음).
 * afterInteractive — GA4와 같은 기준으로, 초기 렌더/LCP 경로를 막지 않는다.
 *
 * REALTOR_PRO_BRIEFING_ADS_ISOLATION_V1 — 예전에는 루트 layout <head>에서 모든 경로에 실렸다.
 * 고객 브리핑(/b/<token>)과 중개사 Pro(/pro) 화면에는 싣지 않는다(src/lib/privacy/private-routes.ts).
 * 브리핑은 외부 링크로만 열리므로(앱 안 링크 없음) 새 문서로 시작해 로더가 한 번도 붙지 않는다.
 */
export default function AdSenseLoader() {
  const pathname = usePathname();
  if (isAdFreePath(pathname)) return null;
  return <Script id="adsense-loader" strategy="afterInteractive" src={ADSENSE_SCRIPT_SRC} crossOrigin="anonymous" />;
}
