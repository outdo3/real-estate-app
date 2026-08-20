'use client';

import React from 'react';
import Chip from './Chip';

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}

// [DESIGN SYSTEM 3 §6] Chip 위에 얇게 얹은 필터 전용 별칭 — 시각/동작은
// Chip과 완전히 동일하되(중복 구현하지 않음), "이건 필터 선택 UI다"라는
// 의미를 이름으로 드러내 Statistics V2 등에서 바로 찾아 쓸 수 있게 한다.
export default function FilterChip({ active, onClick, children, count }: FilterChipProps) {
  return (
    <Chip active={active} onClick={onClick}>
      {children}
      {typeof count === 'number' && <span style={{ opacity: 0.7 }}>({count})</span>}
    </Chip>
  );
}
