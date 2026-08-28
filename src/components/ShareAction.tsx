'use client';

import React from 'react';
import { Share2 } from 'lucide-react';
import { useSharePage, type UseSharePageOptions } from '@/hooks/useSharePage';
import styles from './ShareAction.module.css';

// GLOBAL SHARE SYSTEM V1 — 페이지마다 공유 코드를 복붙하지 않도록 만든 공통 공유 버튼.
// 새로 공유가 필요한 페이지(지도/통계/분양/재개발/커뮤니티/AI검색 등)는 전부 이 컴포넌트를
// 쓴다. 기존 KakaoShareButton(아파트 상세/StickyActionBar/학교 상세)은 이미 안정적으로
// 동작 중이라 회귀 위험 없이 그대로 두고 건드리지 않는다(§11).
export interface ShareActionProps extends UseSharePageOptions {
  /** compact: 아이콘+텍스트 알약 버튼(통계/상세 헤더 등). icon: 아이콘만(지도 컨트롤 바 등). */
  variant?: 'compact' | 'icon';
  /**
   * MAP UI POLISH V1 §2/§4 — icon variant 전용. 'neutral'(기본, 기존 커뮤니티/AI검색
   * 호출부와 동일한 흰 배경+회색 아이콘, 회귀 없음) | 'brand'(이집 Green 원형 배경 +
   * 흰 Share 아이콘, 지도 상단처럼 검색바와 분리된 독립 버튼 자리용). 다른 페이지의
   * icon variant 외형은 이 prop을 명시하지 않는 한 전혀 바뀌지 않는다.
   */
  tone?: 'neutral' | 'brand';
  /** compact variant의 기본(idle) 라벨. */
  label?: string;
  className?: string;
}

export default function ShareAction({ variant = 'compact', tone = 'neutral', label = '공유', className, ...shareOptions }: ShareActionProps) {
  const { status, share } = useSharePage(shareOptions);

  if (variant === 'icon') {
    const toastLabel = status === 'copied' ? '링크를 복사했어요' : status === 'error' ? '공유에 실패했어요' : null;
    const iconBtnClass = tone === 'brand' ? styles.iconBtnBrand : styles.iconBtn;
    return (
      <div className={styles.iconWrap}>
        <button
          type="button"
          onClick={share}
          className={`${iconBtnClass} ${className || ''}`}
          aria-label={tone === 'brand' ? '공유' : '공유하기'}
          title={tone === 'brand' ? '공유' : '공유하기'}
        >
          <Share2 className={styles.icon} aria-hidden="true" />
        </button>
        {toastLabel && <div className={styles.toast}>{toastLabel}</div>}
      </div>
    );
  }

  const compactLabel = status === 'copied' ? '복사됨' : status === 'error' ? '공유 실패' : label;
  return (
    <button
      type="button"
      onClick={share}
      className={`${styles.compactBtn} ${className || ''}`}
      aria-label="공유하기"
      title="공유하기"
    >
      <Share2 className={styles.icon} aria-hidden="true" />
      {compactLabel}
    </button>
  );
}
