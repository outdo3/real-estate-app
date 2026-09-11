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
  /**
   * APT_DETAIL_MOBILE_DENSITY_ACTION_BAR_V1 §10 — 노출 여부.
   *
   * 예전에는 모바일에서 **항상** 떠 있어서 하단탭바(60px)와 합쳐 화면 높이를 상시로
   * 깎아먹었다. 이제 사용자가 페이지를 충분히 본 뒤에만 올라온다. 버튼들의 동작은
   * 하나도 바뀌지 않았다 — 보이는 시점만 바뀐다(§13).
   */
  visible?: boolean;
}

// APT_DETAIL_MOBILE_UX_REGRESSION_HOTFIX — 이전 StickyPriceBar(최근 매매가 반복
// 노출)를 대체한다. 상단(Hero)에서 이미 가격을 충분히 보여주므로, 페이지 끝에서는
// 가격 반복 대신 "관심단지 / 공유 / 글쓰기" 3개 행동에 집중한다(§10~11). 새 favorite/
// share/write 로직을 만들지 않고 기존 컴포넌트/라우트를 그대로 재사용한다(§12~14).
export default function StickyActionBar({ aptName, lawdCd, dong, name, address, shareTitle, shareDescription, visible = true }: StickyActionBarProps) {
  return (
    // 숨김 상태에서도 DOM에는 남는다 — 마운트/언마운트를 반복하면 슬라이드 전환을
    // 줄 수 없고, FavoriteButton이 자기 상태를 다시 읽어야 한다. 보이기만 바꾼다.
    <div className={`${styles.stickyBar} ${visible ? styles.stickyBarVisible : ''}`} aria-hidden={!visible}>
      <div className={styles.stickyActionRow}>
        <div className={styles.stickyActionItem}>
          <FavoriteButton lawdCd={lawdCd} dong={dong} name={name} address={address} />
        </div>
        <div className={styles.stickyActionItem}>
          <KakaoShareButton compact label="공유" title={shareTitle} description={shareDescription} />
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
