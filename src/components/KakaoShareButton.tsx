'use client';

import React from 'react';
import { Share2 } from 'lucide-react';
import { useShareSheet } from '@/hooks/useShareSheet';
import ShareSheet from '@/components/share/ShareSheet';
import type { EjipShareType } from '@/lib/share/ejipShareCard';
import styles from './KakaoShareButton.module.css';

interface KakaoShareButtonProps {
  title: string;
  description: string;
  /** true면 카카오 브랜드 노란 버튼 대신, Hero 등 다른 요소 옆에 자연스럽게 붙는
   *  작고 중립적인 아이콘+텍스트 버튼으로 렌더한다. 겉모습만 다르고 동작은 동일하다. */
  compact?: boolean;
  /** APT DETAIL CONSISTENCY HOTFIX V1 §19 — compact 버튼의 기본(idle) 상태 라벨.
   *  기본값 '공유하기'는 Hero/학교상세 등 기존 호출부 동작을 그대로 유지하고,
   *  StickyActionBar만 짧은 '공유'를 넘겨 3-action bar 폭을 좁게 유지한다. */
  label?: string;
  /**
   * SHARE_CARD_UNIFICATION_V1 §3/§9 — 카카오 카드 CTA 버튼 라벨을 정하는 카드 성격.
   * 이 컴포넌트의 세 호출부(단지 상세 Hero / StickyActionBar / 학교 상세)는 전부
   * 단지 성격이라 기본값이 'apartment'다.
   */
  shareType?: EjipShareType;
}

/**
 * SHARE_UX_V2 §3 — 단지 상세 Hero / StickyActionBar / 학교 상세의 공유 버튼.
 *
 * 겉모습(compact 알약 / 카카오 노란 버튼)과 props는 **그대로**다. 바뀐 것은 클릭 이후다:
 * 예전에는 이 버튼이 "카카오 → 네이티브 → 복사" 캐스케이드를 직접 돌았고, 카카오 SDK가
 * 준비된 모바일에서는 첫 분기에서 끝나 OS 공유 시트가 열릴 일이 없었다. 이집의 가장
 * 큰 공유 표면인 단지 상세에서 바로 그 이유로 "어느 카카오톡으로 보낼지"를 고를 수
 * 없었다. 이제 다른 화면(ShareAction)과 **같은 공통 시트**를 열어 사용자가 고른다 —
 * 세 번째 캐스케이드 구현을 유지하지 않는다(중복 구현 제거).
 */
export default function KakaoShareButton({ title, description, compact, label = '공유하기', shareType = 'apartment' }: KakaoShareButtonProps) {
  const sheet = useShareSheet({ title, text: description, shareType });

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
      heading={title}
    />
  );

  if (compact) {
    return (
      <>
        <button type="button" onClick={sheet.openSheet} className={styles.shareBtn} title="공유하기" aria-haspopup="dialog">
          <Share2 className={styles.icon} aria-hidden="true" />
          {label}
        </button>
        {panel}
      </>
    );
  }

  return (
    <>
      {/* 비-compact(전폭) 변형. 현재 호출부가 없지만 계약을 유지한다.
          라벨은 '카카오톡으로 공유하기'가 아니다 — 이제 버튼이 여는 것은
          채널 선택 시트이고, 카카오는 그 안의 세 선택지 중 하나다. */}
      <button type="button" onClick={sheet.openSheet} className={styles.fullBtn} title="공유하기" aria-haspopup="dialog">
        <Share2 className={styles.icon} aria-hidden="true" />
        공유하기
      </button>
      {panel}
    </>
  );
}
