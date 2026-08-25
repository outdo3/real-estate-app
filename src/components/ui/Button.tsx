'use client';

import React from 'react';
import Link from 'next/link';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  /** variant="icon"이거나 children 없이 아이콘만 보여줄 때 필수. */
  'aria-label'?: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  type?: 'button' | 'submit';
  /** 전달하면 <button> 대신 next/link <Link>로 렌더링한다(페이지 이동용) —
      기존 quickActionBtn류의 <Link className=...> 패턴을 그대로 대체. */
  href?: string;
  target?: string;
  rel?: string;
}

// [DESIGN SYSTEM 3 §3] primary/secondary/tertiary/destructive/icon × sm/md/lg.
// href를 주면 Link로, 안 주면 button으로 렌더링해 네비게이션 버튼과 액션
// 버튼을 하나의 컴포넌트로 함께 다룬다(SectionHeader의 action prop과 같은 패턴).
export default function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  disabled,
  icon,
  children,
  className,
  onClick,
  type = 'button',
  href,
  target,
  rel,
  ...rest
}: ButtonBaseProps) {
  if (process.env.NODE_ENV !== 'production' && (variant === 'icon' || !children) && !rest['aria-label']) {
    console.warn('[Button] icon-only 버튼은 aria-label이 필요합니다.');
  }

  const classes = [styles.btn, styles[variant], styles[size], disabled ? styles.disabled : ''].filter(Boolean).join(' ') + (className ? ` ${className}` : '');
  const content = (
    <>
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : icon}
      {children}
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} target={target} rel={rel} className={classes} aria-label={rest['aria-label']} onClick={onClick} style={rest.style}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={rest['aria-label']}
      aria-busy={loading || undefined}
      style={rest.style}
    >
      {content}
    </button>
  );
}
