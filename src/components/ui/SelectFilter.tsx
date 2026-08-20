import React from 'react';
import styles from './SelectFilter.module.css';

interface SelectFilterOption {
  value: string;
  label: string;
}

interface SelectFilterProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: SelectFilterOption[];
  'aria-label'?: string;
  className?: string;
}

// [DESIGN SYSTEM 3 §6] presales/redevelopment가 각자 반복 구현하던 지역/상태/
// 가격/유형 select를 하나의 presentational wrapper로 통일했다. 옵션 목록과
// 선택 state는 여전히 호출부(비즈니스 로직)가 소유한다 — 이 컴포넌트는 어떤
// 필터 상태도 자체 보관하지 않는다.
export default function SelectFilter({ value, onChange, options, className, ...rest }: SelectFilterProps) {
  return (
    <select className={[styles.select, className].filter(Boolean).join(' ')} value={value} onChange={onChange} aria-label={rest['aria-label']}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
