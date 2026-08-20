import React from 'react';
import styles from './SectionSkeleton.module.css';

interface SectionSkeletonProps {
  /** 줄 수(기본 3). 각 줄 높이는 heights로 개별 지정 가능. */
  lines?: number;
  heights?: string[];
}

// [DESIGN SYSTEM 3 §11] TAGO 버스 도착정보처럼 느린 외부 API를 기다리는 동안
// 전체 페이지를 막지 않고 해당 섹션만 표시하는 skeleton. ApartmentScoreCard가
// 쓰던 pulse 패턴을 그대로 재사용한다.
export default function SectionSkeleton({ lines = 3, heights }: SectionSkeletonProps) {
  return (
    <div className={styles.wrap} role="status" aria-label="불러오는 중">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={styles.line} style={{ height: heights?.[i] || '1rem', width: i === lines - 1 ? '70%' : '100%' }} />
      ))}
    </div>
  );
}
