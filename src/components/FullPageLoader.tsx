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

          효과(Production 통제 실측, 390px / Slow 4G / CPU 4x, 구별 n=10, cold 첫 run 제외):
            라우트 JS 완료 2,377~2,418ms → 1,982~2,055ms (-348~-395ms)
            hydration        2,631~2,708ms → 2,303~2,333ms (-328~-390ms)
            usable(첫 마커)  중구 3,765→3,406 / 부산진구 4,255→3,830 / 해운대구 3,841→3,447
          줄인 68.6KB를 1.6Mbps로 나누면 343ms인데 실측 JS 단축이 348~395ms라 값이 맞는다.

          (기록) 구현 전 로컬에서 "이미지를 차단해도 JS가 안 빨라진다"는 A/B가 나와
          한때 이 가설을 반증된 것으로 판단했는데, 그 A/B가 틀렸다 —
          localhost + Playwright route.abort() 조합이 요청 스케줄링을 바꿔
          실제 대역폭 경쟁을 재현하지 못했다. 위 Production 전후 측정이 정답이다.

          fetchPriority/decoding은 뷰포트 내 이미지 우선순위 부스트를 막고 디코딩을
          메인스레드에서 떼기 위해 함께 남긴다. */}
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
