import React from 'react';
import Link from 'next/link';
import styles from './Empty.module.css';

export type EmptyVariant = 'noData' | 'noResult' | 'notReady';

interface EmptyProps {
  variant: EmptyVariant;
  title?: string;
  description?: string;
  action?: { label: string; href: string };
  /** 마스코트를 숨기고 텍스트만 보여줄 때 false로. 기본은 variant별 권장
      마스코트(public/brand/mascot/README.md)를 그대로 노출. */
  showMascot?: boolean;
}

const DEFAULT_MASCOT: Record<EmptyVariant, string> = {
  noData: '/brand/mascot/ejipy-empty.webp',
  noResult: '/brand/mascot/ejipy-empty.webp',
  // [DESIGN SYSTEM 3 §12] "준비 중"은 오류가 아니다 — ejipy-guide(안내
  // 포즈)를 쓴다. ejipy-error를 여기서 쓰지 않는다(§13/mascot README와 동일).
  notReady: '/brand/mascot/ejipy-guide.webp',
};

const DEFAULT_TITLE: Record<EmptyVariant, string> = {
  noData: '아직 데이터가 없습니다.',
  noResult: '조건에 맞는 결과가 없습니다.',
  notReady: '연동 준비 중입니다.',
};

// [DESIGN SYSTEM 3 §12] noData/noResult/notReady 3종. Error와 시각/문구를
// 분리한다 — "준비 중"을 오류처럼 보이게 하지 않는다(§25 원칙 준수).
export default function Empty({ variant, title, description, action, showMascot = true }: EmptyProps) {
  return (
    <div className={styles.box}>
      {showMascot && <img src={DEFAULT_MASCOT[variant]} alt="" className={styles.mascot} />}
      <div className={styles.title}>{title || DEFAULT_TITLE[variant]}</div>
      {description && <div className={styles.description}>{description}</div>}
      {action && <Link href={action.href} className={styles.action}>{action.label} →</Link>}
    </div>
  );
}
