'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/app/page.module.css';

const TABS = ['아파트', '전월세', '분양권', '오피스텔', '빌라'];

interface SearchFilterProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const SearchFilter: React.FC<SearchFilterProps> = ({ activeTab, onTabChange }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const router = useRouter();

  const handleSearch = () => {
    if (searchTerm.trim()) {
      router.push(`/apt/${encodeURIComponent(searchTerm.trim())}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className={styles.searchSection}>
      <div className={styles.tabs}>
        {TABS.map((tab) => (
          <button 
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.active : ''}`}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      
      <div className={styles.searchBox}>
        <input 
          type="text" 
          placeholder="지역 또는 단지명을 입력하세요." 
          className={styles.searchInput} 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <span className={styles.searchIcon} onClick={handleSearch}>🔍</span>
      </div>
    </div>
  );
}

export default SearchFilter;
