import styles from './AdContainer.module.css';

// 광고/스폰서 배너 구좌. 실제 광고 네트워크(예: 애드센스) 연동·심사 승인 전까지는
// NEXT_PUBLIC_ADS_ENABLED가 'true'로 설정되지 않는 한 아무것도 렌더링하지 않는다
// (빈 공백조차 남기지 않음) — 승인 후 이 플래그만 켜면 이미 배치해둔 구좌 자리에
// 그대로 광고가 노출된다.
const ADS_ENABLED = process.env.NEXT_PUBLIC_ADS_ENABLED === 'true';

interface AdContainerProps {
  variant?: 'banner' | 'native' | 'agent';
  slot: string;
  label?: string;
}

export default function AdContainer({ variant = 'banner', slot, label }: AdContainerProps) {
  if (!ADS_ENABLED) return null;

  if (variant === 'native') {
    return (
      <div className={styles.nativeCard} data-ad-slot={slot}>
        <span className={styles.adBadge}>AD</span>
        <div className={styles.nativePlaceholder}>{label || '광고'}</div>
      </div>
    );
  }

  if (variant === 'agent') {
    return (
      <div className={styles.agentBanner} data-ad-slot={slot}>
        <span className={styles.adBadge}>AD</span>
        <div className={styles.agentPlaceholder}>{label || '추천 지역 중개사'}</div>
      </div>
    );
  }

  return (
    <div className={styles.bannerWrap} data-ad-slot={slot}>
      <div className={styles.bannerPlaceholder}>{label || '광고'}</div>
    </div>
  );
}
