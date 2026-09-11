'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * APT_DETAIL_INLINE_MAP_ROADVIEW_V1 §6 — "화면에 들어올 때 한 번만" 판정.
 *
 * OfficetelLocationCard가 STEP 6에서 쓰던 판정을 그대로 끌어올렸다. 아파트 상세에
 * 같은 카드를 붙이면서 이 까다로운 부분을 복사하지 않기 위해서다.
 *
 * ── 왜 IntersectionObserver만으로는 안 되나 ────────────────────────────────
 * IO 콜백은 렌더 파이프라인에 실려 온다. 그래서 요소가 **이미 화면 안에 있어도**
 * 그 서브트리가 렌더되고 있지 않으면 콜백이 영영 오지 않는다. 실제 QA에서 지도가
 * "불러오는 중" 문구에 멈춘 채 끝나는 것으로 재현됐다.
 *
 * 그래서 세 경로를 함께 쓰고 **먼저 도착하는 쪽이 이긴다**:
 *   1) 마운트 직후 동기 판정 (이미 화면 안이면 즉시)
 *   2) IntersectionObserver
 *   3) scroll/resize 보조 리스너
 *
 * 한 번 true가 되면 다시 false로 돌아가지 않는다 — 지도를 껐다 켜는 것은
 * SDK 재초기화를 부르고, 그건 이 훅이 피하려는 바로 그 비용이다.
 */
export interface LazyInViewOptions {
  /** 화면에 닿기 전에 미리 시작할 여유분(px). */
  marginPx?: number;
  /** false면 관찰 자체를 하지 않는다(예: 좌표가 없어 그릴 것이 없을 때). */
  enabled?: boolean;
}

const DEFAULT_MARGIN_PX = 200;

export function useLazyInView<T extends HTMLElement>(
  options: LazyInViewOptions = {}
): { ref: React.RefObject<T | null>; inView: boolean } {
  const { marginPx = DEFAULT_MARGIN_PX, enabled = true } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!enabled || inView) return;
    const el = ref.current;
    if (!el) return;

    const withinTriggerBand = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      return r.top < vh + marginPx && r.bottom > -marginPx;
    };

    // 1) 동기 판정 — 관찰자를 신뢰의 단일 지점으로 두지 않는다.
    if (withinTriggerBand()) {
      setInView(true);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    let io: IntersectionObserver | null = null;
    const stop = () => {
      io?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    const trigger = () => {
      setInView(true);
      stop();
    };
    const onScroll = () => {
      if (withinTriggerBand()) trigger();
    };

    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) trigger();
      },
      { rootMargin: `${marginPx}px 0px` }
    );
    io.observe(el);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return stop;
  }, [enabled, inView, marginPx]);

  return { ref, inView };
}
