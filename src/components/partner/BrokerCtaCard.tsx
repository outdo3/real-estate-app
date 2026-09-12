'use client';

import { Phone, Store } from 'lucide-react';
import { getBrokerForLocation, telHref } from '@/lib/partners/config';
import usePartnerCta from './usePartnerCta';
import styles from './PartnerCtaCard.module.css';

/**
 * APT_DETAIL_PARTNER_TRADE_DENSITY_V1 §6~§10 — 중개사 파일럿 카드(단지 상세 전용).
 *
 * ── 자격은 위치로만 정한다(§7) ──────────────────────────────────────────────
 * 단지명 문자열을 보지 않는다. canonical 위치(lawdCd + 법정동)가 검증된 영업 구역과
 * **정확히** 일치할 때만 렌더된다. 위치를 모르면 렌더하지 않는다 — 모르는 상태를
 * 자격 있음으로 넘기면 영업 구역 밖 단지에 엉뚱한 중개사가 붙는다.
 *
 * 자격이 없으면 null을 반환하므로 노출 집계도 발생하지 않는다(§21).
 *
 * ── 지어내지 않는 것(§6/§10) ────────────────────────────────────────────────
 * 카카오 채널, 홈페이지, 이메일, 프로필 사진, 사무소 로고, 경력, 수수료, 영업시간.
 * 사진과 로고가 없으므로 중립 아이콘 타일을 **의도적으로** 쓴다 — 깨진 이미지
 * 폴백처럼 보이지 않게.
 *
 * ── 아직 넣지 않는 CTA(§8) ─────────────────────────────────────────────────
 * 카카오 문의 / 집 보러가기 / 매물 보기 / 상담 예약. 그 흐름들이 아직 없기 때문이다.
 * 생기면 이 카드 위에 "이 단지 등록 매물" 블록이 얹히는 형태를 예상하고 있다(§24) —
 * 카드는 그 아래 그대로 남으면 되므로 큰 재작성이 필요 없다.
 */
export default function BrokerCtaCard({
  lawdCd,
  dong,
}: {
  lawdCd?: string | null;
  dong?: string | null;
}) {
  const broker = getBrokerForLocation({ lawdCd, dong }, 'apt_detail');
  const { rootRef, handleClick } = usePartnerCta(broker, 'apt_detail');

  if (!broker) return null;

  return (
    <aside
      ref={rootRef}
      className={styles.card}
      data-export-exclude=""
      aria-label="이 단지 상담 가능한 중개사 안내"
    >
      <p className={styles.sectionTitle}>이 단지 상담 가능한 중개사</p>

      <div className={styles.identity}>
        <span className={styles.identityIcon} aria-hidden="true">
          <Store />
        </span>
        <div style={{ minWidth: 0 }}>
          <p className={styles.partnerName}>{broker.displayName}</p>
          {broker.representative && (
            <p className={styles.partnerSub}>{broker.representative} 공인중개사</p>
          )}
        </div>
      </div>

      {broker.description && <p className={styles.body}>{broker.description}</p>}

      {broker.registrationNumber && (
        <p className={styles.meta}>
          <span className={styles.metaLabel}>중개사무소 등록번호 </span>
          <span className={styles.metaValue}>{broker.registrationNumber}</span>
        </p>
      )}
      {broker.address && <p className={styles.meta}>{broker.address}</p>}

      <div className={styles.actions}>
        <a
          className={`${styles.button} ${styles.phone}`}
          href={telHref(broker)}
          onClick={handleClick('phone')}
          // §9/§25 — 번호는 화면에도 aria에도 쓰지 않는다. 보이면 손으로 걸 수 있고,
          // 그 통화는 어떤 집계에도 남지 않는다.
          aria-label={`${broker.displayName} 전화 문의`}
        >
          <Phone className={styles.icon} aria-hidden="true" />
          전화 문의
        </a>
      </div>
    </aside>
  );
}
