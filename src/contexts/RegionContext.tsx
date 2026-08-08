'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';

export interface RegionState {
  /** 국토부 실거래가 API용 5자리 지역코드 (법정동코드 앞 5자리) */
  lawdCd: string;
  /** 선택된 읍면동 짧은 이름, 미선택(구/군 전체)이면 'all' */
  dong: string;
  /** 시/도 전체 이름 (예: "부산광역시") */
  sido: string;
  /** 시/군/구 이름 (예: "서구") */
  sigungu: string;
  /** 화면에 표시할 전체 지역명 (예: "부산광역시 서구" 또는 "암남동") */
  displayRegionName: string;
}

// 기본값: 서울특별시 강남구 (기존 각 페이지의 기본값과 동일하게 유지)
const DEFAULT_REGION: RegionState = {
  lawdCd: '11680',
  dong: 'all',
  sido: '서울특별시',
  sigungu: '강남구',
  displayRegionName: '서울특별시 강남구 동 전체',
};

interface RegionContextValue {
  region: RegionState;
  setRegion: (region: RegionState) => void;
  isRegionModalOpen: boolean;
  openRegionModal: () => void;
  closeRegionModal: () => void;
}

const RegionContext = createContext<RegionContextValue | null>(null);

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [region, setRegion] = useState<RegionState>(DEFAULT_REGION);
  const [isRegionModalOpen, setIsRegionModalOpen] = useState(false);

  const openRegionModal = useCallback(() => setIsRegionModalOpen(true), []);
  const closeRegionModal = useCallback(() => setIsRegionModalOpen(false), []);

  return (
    <RegionContext.Provider value={{ region, setRegion, isRegionModalOpen, openRegionModal, closeRegionModal }}>
      {children}
    </RegionContext.Provider>
  );
}

// 실거래가(홈)/시장통계/학군정보 등 모든 페이지가 이 훅 하나로 동일한 선택 지역을 공유한다.
// 페이지 간 이동 시 지역이 리셋되거나 서로 다른 기본값으로 튀는 문제(예: 홈에서 "부산광역시
// 서구"를 선택했는데 시장통계 탭은 자체 기본값인 "서울특별시 강남구"를 보여주는 문제)를
// 이 Context가 근본적으로 제거한다.
export function useRegion() {
  const ctx = useContext(RegionContext);
  if (!ctx) throw new Error('useRegion은 RegionProvider 내부에서만 사용할 수 있습니다.');
  return ctx;
}
