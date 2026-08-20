'use client';

import React from 'react';
import Link from 'next/link';
import styles from './Card.module.css';

export type CardVariant = 'basic' | 'interactive' | 'status';

interface CardProps {
  variant?: CardVariant;
  onClick?: () => void;
  href?: string;
  children: React.ReactNode;
  className?: string;
}

// [DESIGN SYSTEM 3 §5] DS1 inventory 재검토 결과 BasicCard/ListRow/StatusCard
// 3종 대신 1개 컴포넌트 + variant로 줄였다(스펙이 허용한 "2~3종이면 충분하면
// 줄여도 됨" 판단) — presales/RedevelopmentListSection의 기존 clickable
// card(role="button" + tabIndex + Enter 키 지원)를 그대로 흡수했다.
export default function Card({ variant = 'basic', onClick, href, children, className }: CardProps) {
  const classes = [styles.card, variant === 'interactive' || variant === 'status' ? styles.interactive : '', variant === 'status' ? styles.statusBar : '', className].filter(Boolean).join(' ');

  if (href) {
    return <Link href={href} className={classes}>{children}</Link>;
  }

  if (onClick) {
    return (
      <div
        className={classes}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      >
        {children}
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
