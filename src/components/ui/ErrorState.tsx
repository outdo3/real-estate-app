import React from 'react';
import { AlertCircle } from 'lucide-react';
import Button from './Button';
import styles from './ErrorState.module.css';

export type ErrorStateVariant = 'inline' | 'section' | 'page';

interface ErrorStateProps {
  variant?: ErrorStateVariant;
  /** 사용자에게 보여줄 안전한 문구만 전달할 것 — 기술 스택/스택트레이스/
      원본 예외 메시지를 그대로 넘기지 않는다(§13). */
  message?: string;
  onRetry?: () => void;
}

const ICON_SIZE: Record<ErrorStateVariant, number> = { inline: 16, section: 28, page: 40 };

// [DESIGN SYSTEM 3 §13] inline/section/page 3종. 마스코트를 쓰지 않는다 —
// public/brand/mascot/README.md의 기존 결정("에러 상태는 신뢰감을 캐릭터
// 보다 우선")을 그대로 따른다. 기본 메시지도 기술적 원문이 아니라 안전한
// 일반 문구다.
export default function ErrorState({ variant = 'section', message = '잠시 후 다시 시도해 주세요.', onRetry }: ErrorStateProps) {
  const boxClass = [styles.box, variant === 'inline' ? styles.inline : '', variant === 'page' ? styles.page : ''].filter(Boolean).join(' ');

  return (
    <div className={boxClass} role="alert">
      <AlertCircle size={ICON_SIZE[variant]} className={styles.icon} aria-hidden="true" />
      <span className={styles.message}>{message}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className={styles.retry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}
