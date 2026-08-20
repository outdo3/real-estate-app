'use client';

import React from 'react';
import styles from './Chip.module.css';

interface ChipProps {
  active?: boolean;
  disabled?: boolean;
  dashed?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

// [DESIGN SYSTEM 2 §16/§18] 선택형 칩의 공통 foundation. AreaSelector의 기존
// 인라인 버튼 스타일(활성 시 solid --primary-color)을 그대로 옮겼다 — 시각적
// 변경 없이 재사용 가능한 형태로만 뽑아냈다.
export default function Chip({ active, disabled, dashed, onClick, children, className }: ChipProps) {
  const classes = [
    styles.chip,
    active ? styles.active : '',
    dashed ? styles.dashed : '',
    disabled ? styles.disabled : '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    <button type="button" className={classes} onClick={disabled ? undefined : onClick} disabled={disabled} aria-pressed={active}>
      {children}
    </button>
  );
}
