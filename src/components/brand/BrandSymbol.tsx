import React from 'react';
import styles from './BrandSymbol.module.css';

export type BrandSymbolTone = 'default' | 'light';

interface BrandSymbolProps {
  size?: number;
  tone?: BrandSymbolTone;
  className?: string;
  // 넘기면 단독 사용(예: 로고 텍스트 없이 심볼만 놓이는 자리)을 위해
  // 접근성 라벨을 노출한다. 기본은 장식용(aria-hidden) — 보통 BrandLogo나
  // 주변 텍스트와 함께 쓰여 심볼 자체가 별도 정보를 전달하지 않기 때문이다.
  ariaLabel?: string;
}

// [BRAND STEP 56-B2] 실제 심볼 그래픽(디자인된 벡터 마크)이 아직 없어,
// 이니셜 모노그램(둥근 배지 + "이")으로 자리를 대신한다 — 이것은 최종
// 심볼 디자인이 아니라 컴포넌트 자리와 API를 미리 확정해두기 위한
// 타이포그래피 기반 placeholder다. 최종 심볼 아트웍이 나오면 이 컴포넌트
// 내부만 이미지/SVG로 교체하면 되고 size/tone API는 그대로 유지된다.
export default function BrandSymbol({ size = 24, tone = 'default', className, ariaLabel }: BrandSymbolProps) {
  return (
    <span
      className={[styles.symbol, styles[tone], className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden={ariaLabel ? undefined : true}
      {...(ariaLabel ? { role: 'img' as const, 'aria-label': ariaLabel } : {})}
    >
      이
    </span>
  );
}
