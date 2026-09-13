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
 *
 * ── E-JIP PARTNER BROKER CARD UI V1 ─────────────────────────────────────────
 * 흰 배경 + 검정 글자라 상세 하단에서 묻혔다. 광고 배너가 아니라 "지역 중개 상담 카드"로
 * 보이게 위계를 세운다: 질문형 제목 → 상호 → 전화번호 → 전화 상담 버튼 → 상담 범위 → 등록번호.
 * 표면은 여전히 중립 톤이다(브랜드 초록 금지 — 이집이 직접 제공하는 기능처럼 보이면 안 된다).
 *
 * 전화번호를 화면에 보인다(이번 STEP 요청). 예전 §4/§9는 번호를 감춰 모든 통화가 집계되는
 * 버튼을 거치게 했다 — 이제 번호를 보고 직접 거는 통화는 집계에 남지 않는다. 그래서 번호는
 * **링크가 아닌 텍스트**로만 두고, 탭해서 거는 경로는 집계되는 버튼 하나뿐이다. 문의 채널이
 * 전화 하나라 버튼도 하나다.
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
      className={`${styles.card} ${styles.brokerCard}`}
      data-export-exclude=""
      aria-label="이 단지 상담 가능한 중개사 안내"
    >
      <div className={styles.brokerLayout}>
        <div className={styles.brokerMain}>
          <p className={styles.brokerBadge}>지역 중개 상담</p>
          <h2 className={styles.brokerTitle}>이 지역 중개가 필요하신가요?</h2>

          <div className={styles.identity}>
            <span className={`${styles.identityIcon} ${styles.brokerIdentityIcon}`} aria-hidden="true">
              <Store />
            </span>
            <div style={{ minWidth: 0 }}>
              <p className={styles.partnerName}>{broker.displayName}</p>
              {broker.representative && (
                <p className={styles.partnerSub}>{broker.representative} 공인중개사</p>
              )}
            </div>
          </div>

          <p className={styles.brokerPhone}>
            <span className={styles.brokerPhoneLabel}>전화</span>
            <span className={styles.brokerPhoneNumber}>{broker.displayPhone}</span>
          </p>

          {broker.description && <p className={styles.brokerArea}>{broker.description}</p>}
        </div>

        <div className={styles.brokerActions}>
          <a
            className={`${styles.button} ${styles.brokerPrimary}`}
            href={telHref(broker)}
            onClick={handleClick('phone')}
            aria-label={`${broker.displayName}에 전화 상담 연결`}
          >
            <Phone className={styles.icon} aria-hidden="true" />
            전화 상담
          </a>
        </div>
      </div>

      {(broker.registrationNumber || broker.address) && (
        <div className={styles.brokerTrust}>
          {broker.registrationNumber && (
            <p className={styles.meta}>
              <span className={styles.metaLabel}>중개사무소 등록번호 </span>
              <span className={styles.metaValue}>{broker.registrationNumber}</span>
            </p>
          )}
          {broker.address && <p className={styles.meta}>{broker.address}</p>}
        </div>
      )}
    </aside>
  );
}
