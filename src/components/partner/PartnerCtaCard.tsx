'use client';

import { MessageCircle, Phone } from 'lucide-react';
import { getPartnerForPlacement, telHref } from '@/lib/partners/config';
import type { PartnerPlacement } from '@/lib/partners/types';
import usePartnerCta from './usePartnerCta';
import styles from './PartnerCtaCard.module.css';

/**
 * PARTNER_LEAD_TRACKING_V1 — 법무사 제휴 CTA 카드.
 *
 * ── 이 카드가 지키는 경계 ───────────────────────────────────────────────────
 * 1. **이집은 고객 정보를 받지 않는다.** 입력 폼이 없다. 사용자는 카카오 오픈채팅이나
 *    전화로 파트너에게 **직접** 연결되고 그 다음 대화는 이집을 거치지 않는다.
 * 2. **이집이 제공하는 서비스가 아님을 말한다.** 카드 하단 면책 문구가 그 역할을 한다.
 * 3. **확인된 사실만 쓴다.** 상호 외에는 어떤 주장도 하지 않는다 — 무료 상담, 상담
 *    지역, 영업 시간, 경력, 수수료, 업무 범위 전부 없다.
 * 4. **추적 리다이렉트를 끼우지 않는다.** 링크는 파트너에게 곧장 간다(§15).
 *    분석은 이동 직전에 로컬에서 끝난다.
 *
 * ── APT_DETAIL_PARTNER_TRADE_DENSITY_V1에서 바뀐 것 ─────────────────────────
 * §2 사용자에게 보이는 "광고·제휴" 배지를 뺐다. 파트너 식별자·타입·추적 의미는 그대로다
 *    (표시 변경이지 파트너 메타데이터 제거가 아니다). 이집이 제공하는 서비스가 아니라는
 *    사실은 하단 면책 문구가 계속 말한다.
 * §3 카드가 화면을 압도하지 않도록 여백과 문구를 줄였다. 데이터가 먼저다.
 * §4 전화번호를 **화면에 쓰지 않는다.** 번호가 보이면 사용자가 손으로 걸 수 있고,
 *    그러면 그 통화는 어떤 집계에도 남지 않아 파트너에게 실제로 무슨 일이 일어났는지
 *    말해줄 수 없게 된다. tel: 링크에는 그대로 들어가므로 기능은 동일하다.
 */
export default function PartnerCtaCard({ placement }: { placement: PartnerPlacement }) {
  const partner = getPartnerForPlacement(placement, 'legal_office');
  const { rootRef, handleClick } = usePartnerCta(partner, placement);

  if (!partner) return null;

  return (
    <aside
      ref={rootRef}
      className={styles.card}
      // 리포트 PNG/PDF 내보내기에 제휴 카드가 섞이지 않게 한다(§8).
      data-export-exclude=""
      aria-label="부동산 등기 상담 안내"
    >
      <p className={styles.sectionTitle}>부동산 등기 상담</p>

      <div className={styles.identity}>
        <p className={styles.partnerName}>{partner.displayName}</p>
      </div>

      <p className={styles.body}>매매 이후 등기 절차가 필요할 때 상담할 수 있습니다.</p>

      <div className={styles.actions}>
        {partner.kakaoUrl && (
          <a
            className={`${styles.button} ${styles.kakao}`}
            href={partner.kakaoUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={handleClick('kakao')}
            aria-label={`${partner.displayName} 카카오 상담`}
          >
            <MessageCircle className={styles.icon} aria-hidden="true" />
            카카오 상담
          </a>
        )}
        <a
          className={`${styles.button} ${styles.phone}`}
          href={telHref(partner)}
          onClick={handleClick('phone')}
          // §4/§25 — aria에도 번호를 넣지 않는다. 스크린리더 사용자에게도 화면과 같은
          // 정보가 가고, 번호가 읽혀서 손으로 걸리는 경로가 생기지 않는다.
          aria-label={`${partner.displayName} 전화 상담`}
        >
          <Phone className={styles.icon} aria-hidden="true" />
          전화 상담
        </a>
      </div>

      <p className={styles.disclaimer}>
        이집이 제공하는 서비스가 아니며, 상담 내용과 비용은 해당 사무실에서 확인해 주세요.
      </p>
    </aside>
  );
}
