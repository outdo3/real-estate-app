'use client';

import React from 'react';
import styles from './SectionHeader.module.css';

interface SectionHeaderAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: SectionHeaderAction;
}

// [DESIGN SYSTEM 2 §22] Statistics V2가 바로 재사용할 수 있는 최소 foundation
// 컴포넌트. 이번 STEP은 컴포넌트만 만들고 기존 페이지의 헤딩을 이걸로
// 교체하지 않는다(§36 — 강제 마이그레이션은 다음 STEP).
export default function SectionHeader({ title, description, action }: SectionHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.textGroup}>
        <h2 className={styles.title}>{title}</h2>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {action && (
        action.href ? (
          <a href={action.href} className={styles.action}>{action.label}</a>
        ) : (
          <button type="button" className={styles.action} onClick={action.onClick}>{action.label}</button>
        )
      )}
    </div>
  );
}
