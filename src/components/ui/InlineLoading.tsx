import React from 'react';
import styles from './InlineLoading.module.css';

interface InlineLoadingProps {
  message?: string;
}

// [DESIGN SYSTEM 3 §11] 좁은 공간(검색창 아래 "확인 중..." 같은 문구)에
// 쓰는 최소 로딩 표시. PageLoading(FullPageLoader)이나 SectionSkeleton과
// 달리 레이아웃을 거의 차지하지 않는다.
export default function InlineLoading({ message = '확인 중...' }: InlineLoadingProps) {
  return (
    <span className={styles.wrap} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {message}
    </span>
  );
}
