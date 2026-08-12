'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import styles from './redevelopment.module.css';

const TABS = [
  { id: 'sale', name: '🏢 분양·청약' },
  { id: 'redevelopment', name: '🏗️ 재개발' },
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
                {tab.name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.emptyCard}>
          <div className={styles.emptyIcon}>{activeTab === 'sale' ? '🏢' : '🏗️'}</div>
          <div className={styles.emptyTitle}>
            {activeTab === 'sale' ? '분양·청약 정보 연동 준비 중입니다.' : '재개발·재건축 구역 정보 연동 준비 중입니다.'}
          </div>
          <div className={styles.emptyDesc}>
            {activeTab === 'sale'
              ? '청약홈 등 공공데이터 연동이 완료되는 대로 지역별 분양 일정과 경쟁률을 제공할 예정입니다.'
              : '정비구역 지정 현황 데이터셋이 연동되는 대로 재개발·재건축 진행 단계를 지도와 함께 제공할 예정입니다.'}
          </div>
          {activeTab === 'sale' && (
            <Link href="/presales" className={styles.emptyLink}>
              분양정보 전체 보기 →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
