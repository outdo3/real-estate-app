'use client';

import React from 'react';
import { Share2 } from 'lucide-react';
import { useShareSheet, type ShareTargetOptions } from '@/hooks/useShareSheet';
import ShareSheet from '@/components/share/ShareSheet';
import styles from './ShareAction.module.css';

// GLOBAL SHARE SYSTEM V1 — 페이지마다 공유 코드를 복붙하지 않도록 만든 공통 공유 버튼.
// 지도/통계/분양/재개발/커뮤니티/AI검색/비교가 전부 이 컴포넌트를 쓴다.
//
// SHARE_UX_V2 §3 — 클릭하면 **공통 공유 시트**가 열린다. 예전에는 이 버튼이 카카오 →
// 네이티브 → 복사 캐스케이드를 돌며 코드가 채널을 골랐고, 모바일에서는 카카오가 항상
// 첫 분기에서 이겨 OS 공유 시트에 도달하지 못했다. 그래서 카카오톡을 두 개 쓰는
// 사용자는 어느 카카오톡으로 보낼지 고를 기회 자체가 없었다. 이제 세 경로를 모두
// 보여주고 사용자가 고른다. 버튼의 외형/props는 그대로다.
export interface ShareActionProps extends ShareTargetOptions {
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
  const sheet = useShareSheet(shareOptions);

  const panel = (
    <ShareSheet
      open={sheet.open}
      onClose={sheet.closeSheet}
      channels={sheet.channels}
      url={sheet.url}
      status={sheet.status}
      onKakao={sheet.shareKakao}
      onNative={sheet.shareNative}
      onCopy={sheet.shareCopy}
      heading={shareOptions.title}
    />
  );

  if (variant === 'icon') {
    const iconBtnClass = tone === 'brand' ? styles.iconBtnBrand : styles.iconBtn;
    return (
      <div className={styles.iconWrap}>
        <button
          type="button"
          onClick={sheet.openSheet}
          className={`${iconBtnClass} ${className || ''}`}
          aria-label={tone === 'brand' ? '공유' : '공유하기'}
          aria-haspopup="dialog"
          title={tone === 'brand' ? '공유' : '공유하기'}
        >
          <Share2 className={styles.icon} aria-hidden="true" />
        </button>
        {panel}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={sheet.openSheet}
        className={`${styles.compactBtn} ${className || ''}`}
        aria-label="공유하기"
        aria-haspopup="dialog"
        title="공유하기"
      >
        <Share2 className={styles.icon} aria-hidden="true" />
        {label}
      </button>
      {panel}
    </>
  );
}
