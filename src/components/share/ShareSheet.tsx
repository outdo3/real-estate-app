'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Link2, MessageCircle, Share2, X } from 'lucide-react';
import type { ShareChannelAvailability } from '@/lib/share/shareChannels';
import type { ShareSheetStatus } from '@/hooks/useShareSheet';
import styles from './ShareSheet.module.css';

export interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  channels: ShareChannelAvailability;
  url: string;
  status: ShareSheetStatus;
  onKakao: () => void;
  onNative: () => void | Promise<void>;
  onCopy: () => void | Promise<void>;
  /** 시트 상단에 보여줄 공유 대상 이름(단지명/통계 제목 등). */
  heading?: string;
}

/**
 * SHARE_UX_V2 §3 — 이집 공통 공유 시트.
 *
 * 모바일에서는 하단 시트, 데스크톱에서는 가운데 작은 모달로 뜬다(같은 마크업, CSS만 다름).
 * 세 액션은 **고정 순서**다 — 화면마다 순서가 달라지면 손이 기억하지 못한다.
 *
 * 캡처 격리(§11): 리포트 이미지/PDF 저장은 data-export-exclude가 붙은 노드를 지운다.
 * 시트는 portal로 body에 붙어 리포트 노드 밖에 있지만, 규칙을 명시적으로 남긴다.
 */
export default function ShareSheet({
  open,
  onClose,
  channels,
  url,
  status,
  onKakao,
  onNative,
  onCopy,
  heading,
}: ShareSheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // ESC로 닫기 + 열릴 때 첫 액션에 포커스 + 닫을 때 원래 버튼으로 포커스 복귀.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) || null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const first = panelRef.current?.querySelector<HTMLElement>('[data-share-action]');
    first?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  if (!open || typeof document === 'undefined') return null;

  const notice =
    status === 'copied'
      ? { tone: 'ok' as const, text: '링크를 복사했어요' }
      : status === 'kakao_failed'
        ? { tone: 'warn' as const, text: '카카오톡으로 보내지 못했어요. 다른 방법을 선택해 주세요.' }
        : status === 'copy_failed'
          ? { tone: 'warn' as const, text: '자동 복사가 안 돼요. 아래 주소를 직접 복사해 주세요.' }
          : null;

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={onClose}
      data-export-exclude=""
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="공유하기"
        onClick={stop}
      >
        <div className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.title}>공유하기</div>
            {heading && <div className={styles.subtitle}>{heading}</div>}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="닫기">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.actions}>
          {channels.kakao && (
            <button type="button" data-share-action="kakao" className={styles.action} onClick={onKakao}>
              <span className={`${styles.iconBox} ${styles.iconKakao}`}>
                <MessageCircle size={22} aria-hidden="true" />
              </span>
              <span className={styles.actionText}>
                <span className={styles.actionLabel}>카카오톡</span>
                <span className={styles.actionHint}>이집 카드로 바로 보내기</span>
              </span>
            </button>
          )}

          {channels.native && (
            <button type="button" data-share-action="native" className={styles.action} onClick={onNative}>
              <span className={`${styles.iconBox} ${styles.iconNative}`}>
                <Share2 size={20} aria-hidden="true" />
              </span>
              <span className={styles.actionText}>
                <span className={styles.actionLabel}>공유하기</span>
                {/* 듀얼 카카오톡/업무용 프로필은 이 OS 시트에서 사용자가 직접 고른다.
                    이집은 어느 카카오톡인지 대신 고르지 않는다. */}
                <span className={styles.actionHint}>다른 앱 선택 (카카오톡이 여러 개면 여기서 선택)</span>
              </span>
            </button>
          )}

          <button type="button" data-share-action="copy" className={styles.action} onClick={onCopy}>
            <span className={`${styles.iconBox} ${styles.iconCopy}`}>
              {status === 'copied' ? <Check size={20} aria-hidden="true" /> : <Link2 size={20} aria-hidden="true" />}
            </span>
            <span className={styles.actionText}>
              <span className={styles.actionLabel}>링크 복사</span>
              <span className={styles.actionHint}>{status === 'copied' ? '복사 완료' : '주소를 클립보드에 복사'}</span>
            </span>
          </button>
        </div>

        {notice && (
          <div className={notice.tone === 'ok' ? styles.noticeOk : styles.noticeWarn} role="status">
            {notice.text}
          </div>
        )}

        {/* §5 — 무엇이 복사되는지 숨기지 않는다. 자동 복사가 막힌 환경(iOS 저장모드,
            권한 거부 등)에서는 이 칸이 유일한 탈출구다. */}
        {status === 'copy_failed' && (
          <input className={styles.urlBox} readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="공유 주소" />
        )}
      </div>
    </div>,
    document.body
  );
}
