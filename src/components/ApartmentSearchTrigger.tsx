'use client';

import React from 'react';
import { Search } from 'lucide-react';
import styles from './ApartmentSearchTrigger.module.css';

interface ApartmentSearchTriggerProps {
  onOpen: () => void;
}

// [APT DETAIL UX QA] 기존엔 38x38 원형 아이콘 버튼(🔍 이모지)만 Header의 searchSlot
// (flex:1, max-width:320px로 이미 검색창 자리를 넉넉히 잡아둔 영역)에 덩그러니 떠 있어
// "완성된 검색창"이 아니라 어중간한 아이콘처럼 보였다. 실제 검색 입력/이동 로직(모달,
// 라우팅)은 그대로 두고, 트리거를 placeholder가 보이는 완성된 검색창 모양으로만
// 바꾼다 — 기능/route 변경 없음.
export default function ApartmentSearchTrigger({ onOpen }: ApartmentSearchTriggerProps) {
  return (
    <button type="button" onClick={onOpen} className={styles.trigger} aria-label="아파트명, 지역명 검색">
      <Search size={18} className={styles.icon} aria-hidden="true" />
      <span className={styles.placeholder}>아파트명, 지역명 검색</span>
    </button>
  );
}
