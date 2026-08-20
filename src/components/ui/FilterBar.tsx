import React from 'react';
import styles from './FilterBar.module.css';

interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
}

// [DESIGN SYSTEM 3 §6] Statistics V2 선행조건. presales/redevelopment가 이미
// 쓰던 filterBar 레이아웃(모바일 wrap, 데스크톱 한 줄)을 그대로 옮겼다 —
// 필터 state/로직은 이 컴포넌트가 갖지 않고 children(SelectFilter 등)이
// 각자 관리한다.
export default function FilterBar({ children, className }: FilterBarProps) {
  return <div className={[styles.bar, className].filter(Boolean).join(' ')}>{children}</div>;
}
