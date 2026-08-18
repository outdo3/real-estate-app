import React from 'react';
import styles from './BrandLogo.module.css';

export type BrandLogoVariant = 'horizontal' | 'compact';
export type BrandLogoTone = 'default' | 'light';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  tone?: BrandLogoTone;
  className?: string;
  // 같은 화면에 이미 "이집"이 텍스트(예: 페이지 타이틀)로 한 번 더 읽히는
  // 경우, 스크린리더 중복 안내를 막기 위해 이 값을 넘기면 내부 텍스트를
  // aria-hidden 처리하고 이 라벨 하나로만 안내한다. 기본은 일반 텍스트라
  // 별도 처리 없이도 그대로 읽힌다.
  ariaLabel?: string;
}

// [BRAND STEP 56-B2] 실제 로고 그래픽(벡터 워드마크) 자산이 아직 없어
// 텍스트 워드마크로 렌더링한다 — 자산이 준비되면 이 컴포넌트 내부만
// 이미지/SVG로 교체하면 되고 variant/tone API는 그대로 유지된다.
export default function BrandLogo({ variant = 'horizontal', tone = 'default', className, ariaLabel }: BrandLogoProps) {
  return (
    <span
      className={[styles.logo, styles[variant], styles[tone], className].filter(Boolean).join(' ')}
      {...(ariaLabel ? { role: 'img' as const, 'aria-label': ariaLabel } : {})}
    >
      <span className={styles.main} aria-hidden={ariaLabel ? true : undefined}>이집</span>
      {variant === 'horizontal' && (
        <span className={styles.sub} aria-hidden={ariaLabel ? true : undefined}>e-jip</span>
      )}
    </span>
  );
}
