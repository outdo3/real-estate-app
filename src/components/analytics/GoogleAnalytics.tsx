'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import {
  GA_DEBUG_MODE,
  GA_MEASUREMENT_ID,
  gaInitScriptBody,
  gaPageView,
  gaRuntimeEnabled,
  getInitialLocationHref,
} from '@/lib/analytics/ga';

/**
 * GA4_INTEGRATION_V1 §3/§4 — GA4 로더 + App Router page_view.
 *
 * 설계 결정
 * ─────────
 * 1) **새 의존성을 추가하지 않는다.** @next/third-parties나 react-ga4 대신
 *    next/script + 공식 gtag 스니펫을 쓴다. package.json은 현재 사용자 작업으로
 *    수정돼 있어 건드리지 않으며, 이 방식이 기능적으로 동일하면서 더 가볍다.
 *
 * 2) **스크립트를 effect 이후에만 마운트한다.** 서버에서는 아무것도 렌더하지 않으므로
 *    hydration 불일치가 원천적으로 없고, QA suppression 플래그(sessionStorage)가
 *    ViewTracker의 마운트 effect에서 확정된 **뒤에** 판단할 수 있다. AppProviders에서
 *    ViewTracker 다음에 놓이는 이유가 이것이다.
 *
 * 3) **자동 page_view를 끈다(send_page_view:false)** — 자동 집계와 수동 집계가 함께
 *    켜지면 최초 로드가 두 번 잡힌다. 경로 변경 시 우리가 한 번만 보낸다.
 *
 * 4) **useSearchParams를 쓰지 않는다.** 루트 레이아웃 아래의 클라이언트 컴포넌트에서
 *    useSearchParams를 쓰면 앱 전체가 정적 렌더링에서 이탈한다(Next 16). 대신
 *    usePathname으로 트리거하고 쿼리는 effect 시점에 window.location에서 읽는다.
 *    부수 효과로 지도 패닝처럼 **쿼리만 바뀌는 변화는 page_view를 만들지 않는다** —
 *    GA4 입장에서는 노이즈이므로 오히려 바람직하다.
 */
export default function GoogleAnalytics() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  // 첫 page_view는 "유입 시점 URL 스냅샷"으로 보낸다(§6 — utm 보존).
  const isFirstPageView = useRef(true);

  useEffect(() => {
    setEnabled(gaRuntimeEnabled());
  }, []);

  useEffect(() => {
    if (!enabled || !pathname) return;
    if (isFirstPageView.current) {
      isFirstPageView.current = false;
      gaPageView(getInitialLocationHref());
      return;
    }
    gaPageView(null);
  }, [enabled, pathname]);

  if (!enabled) return null;

  return (
    <>
      {/* afterInteractive — 초기 렌더/LCP 경로를 막지 않는다(§22). */}
      <Script
        id="ga4-lib"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {gaInitScriptBody(GA_MEASUREMENT_ID, GA_DEBUG_MODE)}
      </Script>
    </>
  );
}
