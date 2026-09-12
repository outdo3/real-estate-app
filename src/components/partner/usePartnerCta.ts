'use client';

import { useEffect, useRef } from 'react';
import { trackEvent } from '@/lib/analytics/trackEvent';
import type { PartnerChannel, PartnerConfig, PartnerPlacement } from '@/lib/partners/types';

/**
 * APT_DETAIL_PARTNER_TRADE_DENSITY_V1 §20/§21 — 파트너 카드의 노출·클릭 집계.
 *
 * 법무사 카드와 중개사 카드가 같은 규칙을 쓰도록 훅 하나로 모았다. 카드마다 집계
 * 코드를 복붙하면 한쪽만 고쳐지고 두 파트너의 숫자가 다른 의미를 갖게 된다.
 *
 * ── 클릭은 상담이 아니다(§22) ───────────────────────────────────────────────
 * 이벤트 이름은 `partner_cta_click`으로 고정한다. lead / conversion 같은 이름을 쓰지
 * 않는다 — 우리가 아는 것은 "버튼을 눌렀다"까지이고, 전화가 실제로 연결됐는지,
 * 상담이 이뤄졌는지, 계약이 됐는지는 **확인할 수단이 없다.**
 */
export default function usePartnerCta(partner: PartnerConfig | null, placement: PartnerPlacement) {
  const rootRef = useRef<HTMLElement | null>(null);
  // 노출은 **마운트당 한 번**만 센다. React가 같은 카드를 여러 번 렌더하거나
  // 카드가 화면을 들락날락해도 숫자가 부풀지 않는다.
  const impressionSent = useRef(false);

  useEffect(() => {
    // §21 — 자격이 없어 카드가 렌더되지 않으면 노출도 없다. partner가 null이면
    // 여기서 바로 끝나므로, 영업 구역 밖 단지에서는 중개사 노출이 기록되지 않는다.
    if (!partner) return;
    const el = rootRef.current;
    if (!el) return;
    // IntersectionObserver가 없으면 **아무것도 보내지 않는다.** 노출은 "실제로 보였다"는
    // 뜻이어야 하므로, 확인할 수 없을 때 일단 세고 보는 쪽이 더 나쁘다.
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (impressionSent.current) return;
          impressionSent.current = true;
          trackEvent('partner_cta_impression', {
            ga: {
              partner_type: partner.type,
              partner_id: partner.id,
              placement,
            },
          });
          observer.disconnect();
          return;
        }
      },
      // 절반이 보일 때. 살짝 스쳐 지나간 것을 노출로 세지 않는다.
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [partner, placement]);

  // 클릭: **먼저 기록하고 그다음 기본 동작(이동/전화)을 그대로 흘려보낸다.**
  // preventDefault를 쓰지 않는 이유 — gaEvent는 dataLayer에 동기적으로 쌓이고
  // 1st-party fetch는 keepalive라 페이지를 떠나도 살아남는다. 그래서 사용자를
  // 한 프레임도 붙잡아 둘 이유가 없다(§9 — tel: 이동 전에 지연을 만들지 않는다).
  const handleClick = (channel: PartnerChannel) => () => {
    if (!partner) return;
    trackEvent('partner_cta_click', {
      ga: {
        partner_type: partner.type,
        partner_id: partner.id,
        placement,
        channel,
      },
    });
  };

  return { rootRef, handleClick };
}
