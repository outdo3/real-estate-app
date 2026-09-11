'use client';

import { useEffect, useRef } from 'react';
import { MessageCircle, Phone } from 'lucide-react';
import { trackEvent } from '@/lib/analytics/trackEvent';
import { getPartnerForPlacement, telHref } from '@/lib/partners/config';
import type { PartnerChannel, PartnerPlacement } from '@/lib/partners/types';
import styles from './PartnerCtaCard.module.css';

/**
 * PARTNER_LEAD_TRACKING_V1 — 제휴 파트너 CTA 카드.
 *
 * ── 이 카드가 지키는 경계 ───────────────────────────────────────────────────
 * 1. **이집은 고객 정보를 받지 않는다.** 입력 폼이 없다. 사용자는 카카오 오픈채팅이나
 *    전화로 파트너에게 **직접** 연결되고 그 다음 대화는 이집을 거치지 않는다.
 * 2. **광고임을 숨기지 않는다.** 카드 맨 위 "광고·제휴" 배지가 항상 먼저 보인다.
 *    이집의 객관적 데이터(점수/시세/실거래)와 섞이지 않도록 시각적으로 분리한다.
 * 3. **확인된 사실만 쓴다.** 상호와 전화번호 외에는 어떤 주장도 하지 않는다 —
 *    무료 상담, 상담 지역, 영업 시간, 경력, 수수료, 업무 범위 전부 없다.
 * 4. **추적 리다이렉트를 끼우지 않는다.** 링크는 파트너에게 곧장 간다(§15).
 *    분석은 이동 직전에 로컬에서 끝난다.
 */
export default function PartnerCtaCard({ placement }: { placement: PartnerPlacement }) {
  const partner = getPartnerForPlacement(placement);
  const rootRef = useRef<HTMLElement | null>(null);
  // 노출은 **마운트당 한 번**만 센다. React가 같은 카드를 여러 번 렌더하거나
  // 카드가 화면을 들락날락해도 숫자가 부풀지 않는다(§10).
  const impressionSent = useRef(false);

  useEffect(() => {
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

  if (!partner) return null;

  // 클릭: **먼저 기록하고 그다음 기본 동작(이동/전화)을 그대로 흘려보낸다.**
  // preventDefault를 쓰지 않는 이유 — gaEvent는 dataLayer에 동기적으로 쌓이고
  // 1st-party fetch는 keepalive라 페이지를 떠나도 살아남는다. 그래서 사용자를
  // 한 프레임도 붙잡아 둘 이유가 없다(§11).
  const handleClick = (channel: PartnerChannel) => () => {
    trackEvent('partner_cta_click', {
      ga: {
        partner_type: partner.type,
        partner_id: partner.id,
        placement,
        channel,
      },
    });
  };

  return (
    <aside
      ref={rootRef}
      className={styles.card}
      // 리포트 PNG/PDF 내보내기에 광고가 섞이지 않게 한다(§8). 현재 배치에는
      // 리포트가 없지만, 나중에 리포트에 얹더라도 이 속성 덕분에 기본이 "제외"다.
      data-export-exclude=""
      aria-label="제휴 파트너 상담 안내"
    >
      <span className={styles.badge}>광고·제휴</span>

      <h2 className={styles.title}>부동산 등기 상담이 필요하신가요?</h2>
      <p className={styles.partnerName}>{partner.displayName}</p>
      <p className={styles.body}>
        매매 이후 등기 절차와 관련해 상담이 필요할 경우 법무사 사무실로 바로 문의할 수 있습니다.
      </p>

      <div className={styles.actions}>
        <a
          className={`${styles.button} ${styles.kakao}`}
          href={partner.kakaoUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={handleClick('kakao')}
        >
          <MessageCircle className={styles.icon} aria-hidden="true" />
          카카오톡 상담
        </a>
        <a
          className={`${styles.button} ${styles.phone}`}
          href={telHref(partner)}
          onClick={handleClick('phone')}
        >
          <Phone className={styles.icon} aria-hidden="true" />
          전화 상담
          <span className={styles.phoneNumber}>{partner.displayPhone}</span>
        </a>
      </div>

      <p className={styles.disclaimer}>
        이집이 제공하는 서비스가 아니며, 상담 내용과 비용은 해당 사무실에 직접 확인해 주세요.
      </p>
    </aside>
  );
}
