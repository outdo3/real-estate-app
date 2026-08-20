import React from 'react';
import styles from './Badge.module.css';

export type BadgeVariant = 'beta' | 'status' | 'positive' | 'negative' | 'warning' | 'neutral' | 'regionalStrength';

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

// [DESIGN SYSTEM 2 §20] positive/negative는 "성공/실패"가 아니라 이 앱의
// 가격 상승/하락(--up-color/--down-color) 관행을 그대로 잇는다 — 브랜드
// 그린이나 --error-color를 여기 재사용하지 않는다(§5 semantic 분리 원칙).
export default function Badge({ variant, children, className }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[variant], className || ''].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
