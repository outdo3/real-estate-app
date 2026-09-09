'use client';

import React, { useState } from 'react';
import LivingEnvironmentPanel from '@/components/LivingEnvironmentPanel';
import NeighborhoodInfoPanel from '@/components/NeighborhoodInfoPanel';
import EducationPanel from '@/components/EducationPanel';
import styles from '@/app/apt/[name]/detail.module.css';

export type InfraTab = '환경' | '교통' | '학군';

interface InfraTabSectionProps {
  primaryAddress: string;
  addressReady: boolean;
  aptName: string;
  lawdCd: string;
  dong: string;
}

/**
 * PERCEIVED_PERFORMANCE_V2 §7 — "단지 주변 생활정보" 탭 영역.
 *
 * 왜 컴포넌트로 분리했나(감사 V1 실측): `infraTab` 상태가 1,241줄짜리 상세페이지
 * 컴포넌트 최상단에 있어서, 탭 버튼을 누를 때마다 히어로/차트/거래목록/커뮤니티까지
 * **페이지 전체가 다시 렌더**됐다. 그 결과 탭 재진입 시 버튼에 active 표시가 뜨기까지
 * median 589ms / worst 1,237ms가 걸렸다 — 최초 클릭(95ms)보다 오히려 느렸다.
 * 상태를 이 하위 트리로 내리면 탭 클릭의 렌더 범위가 이 영역으로 한정된다.
 *
 * 동작은 그대로 유지한다:
 *  - 한 번 연 탭은 계속 마운트해두고 `display`만 토글한다(재진입 시 재조회 0건이라는
 *    기존 UX QA 결론을 그대로 보존 — KakaoPlaces/BusAccessCard/EducationPanel이
 *    unmount되면 geocode+API를 처음부터 다시 하게 된다).
 *  - 방문한 적 없는 탭은 마운트하지 않는다(불필요한 외부 API 호출을 늘리지 않는다).
 *  - 라벨/아이콘/클래스/순서 모두 기존과 동일하다.
 */
export default function InfraTabSection({ primaryAddress, addressReady, aptName, lawdCd, dong }: InfraTabSectionProps) {
  const [infraTab, setInfraTab] = useState<InfraTab>('환경');
  const [visitedInfraTabs, setVisitedInfraTabs] = useState<Set<InfraTab>>(new Set(['환경']));

  return (
    <>
      <div className={styles.infraTabBar}>
        {(['환경', '교통', '학군'] as InfraTab[]).map((tab) => (
          <button
            key={tab}
            className={`${styles.infraTabBtn} ${infraTab === tab ? styles.infraTabBtnActive : ''}`}
            onClick={() => {
              setInfraTab(tab);
              setVisitedInfraTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
            }}
          >
            <span className={styles.infraTabIcon}>{tab === '환경' ? '🏡' : tab === '교통' ? '🚇' : '🏫'}</span>
            <span className={styles.infraTabLabel}>{tab === '환경' ? '주거환경' : tab === '교통' ? '교통·편의' : '학군'}</span>
          </button>
        ))}
      </div>

      {visitedInfraTabs.has('환경') && (
        <div style={{ display: infraTab === '환경' ? 'block' : 'none' }}>
          <LivingEnvironmentPanel address={primaryAddress} ready={addressReady} />
        </div>
      )}
      {visitedInfraTabs.has('교통') && (
        <div style={{ display: infraTab === '교통' ? 'block' : 'none' }}>
          <NeighborhoodInfoPanel address={primaryAddress} ready={addressReady} />
        </div>
      )}
      {visitedInfraTabs.has('학군') && (
        <div style={{ display: infraTab === '학군' ? 'block' : 'none' }}>
          <EducationPanel aptName={aptName} lawdCd={lawdCd} dong={dong} ready={addressReady} />
        </div>
      )}
    </>
  );
}
