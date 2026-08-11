'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { REGION_DATA } from '@/lib/regions';

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

// GPS 위치 조회에 실패했을 때(권한 거부, 비-브라우저 환경, 좌표 역지오코딩 실패 등)의
// 최종 폴백 — 이전 기본값(서울 강남구)은 유저 위치와 무관하게 항상 고정돼 있어, 다른
// 지역(예: 부산 서구) 유저에게는 매번 엉뚱한 지역으로 시작하는 문제가 있었다. 이 앱이
// 실제로 가장 많이 다루는 지역(부산 서구, /map·/api/ai-search의 기본 대상 지역과 동일)을
// GPS 실패 시의 폴백으로 삼는다.
const FALLBACK_REGION: RegionState = {
  lawdCd: '26140',
  dong: 'all',
  sido: '부산광역시',
  sigungu: '서구',
  displayRegionName: '부산광역시 서구 동 전체',
};

// 카카오 역지오코딩이 돌려주는 축약형 시/도명(예: "부산")을 REGION_DATA의 정식 명칭
// ("부산광역시")으로 보정한다.
function normalizeSido(raw: string): string {
  if (REGION_DATA[raw]) return raw;
  const found = Object.keys(REGION_DATA).find((full) => full.startsWith(raw) || raw.startsWith(full.slice(0, 2)));
  return found || raw;
}

interface RegionContextValue {
  region: RegionState;
  setRegion: (region: RegionState) => void;
  isRegionModalOpen: boolean;
  openRegionModal: () => void;
  closeRegionModal: () => void;
}

const RegionContext = createContext<RegionContextValue | null>(null);

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [region, setRegion] = useState<RegionState>(FALLBACK_REGION);
  const [isRegionModalOpen, setIsRegionModalOpen] = useState(false);
  // 유저가 이미 지역을 직접 선택했다면(RegionSelectModal 등을 통해) GPS 조회가 뒤늦게
  // 끝나더라도 그 선택을 덮어쓰지 않는다.
  const userSelectedRef = useRef(false);

  const handleSetRegion = useCallback((next: RegionState) => {
    userSelectedRef.current = true;
    setRegion(next);
  }, []);

  const openRegionModal = useCallback(() => setIsRegionModalOpen(true), []);
  const closeRegionModal = useCallback(() => setIsRegionModalOpen(false), []);

  // 최초 진입 시 브라우저 GPS로 유저의 실제 위치를 알아내 그 위치의 시/군/구를 기본
  // 선택 지역으로 삼는다. 이 서비스는 이미 클라이언트에서 Kakao JS 키로 지도 SDK를 쓰고
  // 있어 도메인이 이미 화이트리스트에 등록돼 있으므로, 브라우저가 자동으로 보내는 실제
  // Origin만으로 REST 역지오코딩 호출이 인증된다(서버 사이드 호출과 달리 KA/Origin
  // 헤더 위장이 필요 없다).
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;
    const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
    if (!kakaoKey) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled || userSelectedRef.current) return;
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${longitude}&y=${latitude}`,
            { headers: { Authorization: `KakaoAK ${kakaoKey}` } }
          );
          if (!res.ok) return;
          const data = await res.json();
          const bRegion = (data.documents || []).find((d: any) => d.region_type === 'B');
          if (cancelled || userSelectedRef.current) return;
          if (bRegion?.code && bRegion.region_1depth_name && bRegion.region_2depth_name) {
            const sido = normalizeSido(bRegion.region_1depth_name);
            setRegion({
              lawdCd: String(bRegion.code).substring(0, 5),
              dong: 'all',
              sido,
              sigungu: bRegion.region_2depth_name,
              displayRegionName: `${sido} ${bRegion.region_2depth_name} 동 전체`,
            });
          }
        } catch (e) {
          // 실패 시 FALLBACK_REGION을 그대로 유지한다.
        }
      },
      () => {
        // 위치 권한 거부/타임아웃 — FALLBACK_REGION을 그대로 유지한다.
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RegionContext.Provider value={{ region, setRegion: handleSetRegion, isRegionModalOpen, openRegionModal, closeRegionModal }}>
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
