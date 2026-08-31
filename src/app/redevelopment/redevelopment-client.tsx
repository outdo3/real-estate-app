'use client';

import React, { useState } from 'react';
import { FileText, Building2 } from 'lucide-react';
import Header from '@/components/Header';
import RedevelopmentListSection from './RedevelopmentListSection';
import { PresaleListSection } from '@/app/presales/presales-client';
import styles from './redevelopment.module.css';

// [DESIGN SYSTEM 3 §22] 이 파일을 이번 STEP에서 직접 손대는 김에 탭 emoji를
// Lucide로 교체했다(전체 emoji 일괄 교체는 범위 밖 — 이 영역만).
const TABS = [
  { id: 'sale', name: '분양·청약', Icon: FileText },
  { id: 'redevelopment', name: '재개발', Icon: Building2 },
];

export default function RedevelopmentClient() {
  const [activeTab, setActiveTab] = useState(TABS[0].id);

  return (
    <div className={styles.main}>
      <Header pageTitle="재개발·분양" />
      <div className="container">
        <div className={styles.header}>
          <p className={styles.headerDesc}>청약·분양 일정과 재개발·재건축 구역 정보를 한곳에서 확인하세요.</p>
          <div className={styles.tabsContainer}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`${styles.tab} ${activeTab === tab.id ? styles.activeTab : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.Icon size={16} strokeWidth={2} aria-hidden="true" style={{ marginRight: '0.35rem', verticalAlign: '-3px' }} />
                {tab.name}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'sale' ? (
          <PresaleListSection />
        ) : (
          <RedevelopmentListSection />
        )}
      </div>
    </div>
  );
}
