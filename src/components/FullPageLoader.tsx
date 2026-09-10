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
      {/* PERCEIVED_PERFORMANCE_V2_6 §1/§2 — 이 마스코트는 **800x800 원본(82,492 B)**인데
          화면에는 96px(모바일 76px)로만 그려졌다. 약 8배 과샘플링이라 순수한 낭비다.
          같은 그림을 256x256으로 다시 인코딩해 13,912 B로 줄였다(-83%).
          256은 데스크톱 96px@2x(192)와 모바일 76px@3x(228)를 모두 덮는다.
          표시 크기는 CSS(.mascot)가 그대로 고정하므로 레이아웃 시프트가 없고,
          그림/브랜딩은 동일하다(원본 파일은 다른 용도를 위해 그대로 둔다).

          주의 — 이 변경은 **바이트 절약이지 지연 개선이 아니다.** 이미지가 라우트 JS를
          늦춘다는 가설은 실험으로 반증됐다: 이미지를 아예 차단해도 라우트 JS 완료
          시각이 2,290ms → 2,318ms로 제자리였다(로컬 A/B, Slow 4G/4x, 각 n=3).
          브라우저가 이미 스크립트에 우선순위를 주고 있어서 이미지는 남는 대역만 쓴다.
          fetchPriority/decoding은 그래서 "이득이 증명된 최적화"가 아니라, 뷰포트 내
          이미지에 붙는 우선순위 부스트를 막고 디코딩을 메인스레드에서 떼는 안전한
          기본값으로만 남긴다. */}
      <img
        src="/brand/mascot/ejipy-loading-256.webp"
        alt=""
        className={styles.mascot}
        fetchPriority="low"
        decoding="async"
      />
      <div className={styles.spinner} />
      <p className={styles.message}>{message}</p>
    </div>
  );
}
