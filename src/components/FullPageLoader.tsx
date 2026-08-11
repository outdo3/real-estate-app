'use client';

import React, { useEffect, useState } from 'react';
import styles from './FullPageLoader.module.css';

interface FullPageLoaderProps {
  active: boolean;
  message?: string;
}

// 앱 전역 브랜드 로딩 오버레이. active가 false로 바뀌어도 CSS 트랜지션(fade-out)이 끝날
// 때까지는 DOM에 남아있어야 부드럽게 사라진다 — 그래서 active를 그대로 언마운트 조건으로
// 쓰지 않고, 트랜지션 시간만큼 지연시킨 mounted 상태를 따로 둔다.
const FADE_MS = 300;

export default function FullPageLoader({ active, message = '스마트한 아파트 분석을 준비 중입니다...' }: FullPageLoaderProps) {
  const [mounted, setMounted] = useState(active);

  useEffect(() => {
    if (active) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(t);
  }, [active]);

  if (!mounted) return null;

  return (
    <div className={`${styles.overlay} ${active ? styles.visible : ''}`} role="status" aria-live="polite">
      <div className={styles.logo}>🏢 이집</div>
      <div className={styles.spinner} />
      <p className={styles.message}>{message}</p>
    </div>
  );
}
