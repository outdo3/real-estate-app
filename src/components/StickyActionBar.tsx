import React from 'react';
import Link from 'next/link';
import { MessageSquarePlus } from 'lucide-react';
import FavoriteButton from './FavoriteButton';
import KakaoShareButton from './KakaoShareButton';
import styles from '@/app/apt/[name]/detail.module.css';

interface StickyActionBarProps {
  aptName: string;
  lawdCd: string;
  dong: string;
  name: string;
  address: string;
  shareTitle: string;
  shareDescription: string;
}

// APT_DETAIL_MOBILE_UX_REGRESSION_HOTFIX — 이전 StickyPriceBar(최근 매매가 반복
// 노출)를 대체한다. 상단(Hero)에서 이미 가격을 충분히 보여주므로, 페이지 끝에서는
// 가격 반복 대신 "관심단지 / 공유 / 글쓰기" 3개 행동에 집중한다(§10~11). 새 favorite/
// share/write 로직을 만들지 않고 기존 컴포넌트/라우트를 그대로 재사용한다(§12~14).
export default function StickyActionBar({ aptName, lawdCd, dong, name, address, shareTitle, shareDescription }: StickyActionBarProps) {
  return (
    <div className={styles.stickyBar}>
      <div className={styles.stickyActionRow}>
        <div className={styles.stickyActionItem}>
          <FavoriteButton lawdCd={lawdCd} dong={dong} name={name} address={address} />
        </div>
        <div className={styles.stickyActionItem}>
          <KakaoShareButton compact title={shareTitle} description={shareDescription} />
        </div>
        <div className={styles.stickyActionItem}>
          <Link href={`/community/write?aptName=${encodeURIComponent(aptName)}`} className={styles.stickyWriteBtn}>
            <MessageSquarePlus className={styles.stickyWriteIcon} aria-hidden="true" />
            글쓰기
          </Link>
        </div>
      </div>
    </div>
  );
}
