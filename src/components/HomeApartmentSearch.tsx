'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import ApartmentAutocomplete, { ApartmentSearchResult } from './ApartmentAutocomplete';
import styles from '@/app/home-client.module.css';

// [MAIN UI-B1] 홈 첫 화면의 Primary 검색. ApartmentAutocomplete(카카오 키워드 검색,
// /map·/stats·상세페이지에서 이미 쓰는 컴포넌트)를 그대로 재사용한다. 선택 시
// 상세페이지로 이동하기 전 실거래 API로 이름+동 조합이 실제로 연결되는지 확인하는
// 흐름은 ApartmentQuickSearch.tsx의 handleSelect와 동일한 방식을 홈 전용으로
// 다시 구현한 것이다.
//
// ApartmentQuickSearch 자체를 재사용하지 않는 이유: 그 컴포넌트는 상세페이지
// 모달로 "열렸다가 닫히는" 것을 전제로 popstate 리스너를 등록해 뒤로가기를 "닫기"로
// 흉내내는데, 홈에서는 이 검색창이 페이지와 함께 상시 마운트돼 있어 그 history push가
// 사용자가 누르지도 않은 뒤로가기 한 번을 무의미하게 소모하는 회귀를 만든다. 그래서
// 검증+이동 로직만 홈 전용으로 새로 작성했고, 상세페이지 LOCK 대상 파일
// (ApartmentQuickSearch.tsx)은 건드리지 않았다.
export default function HomeApartmentSearch() {
  const router = useRouter();
  const [verifying, setVerifying] = useState(false);
  const [connectFailed, setConnectFailed] = useState<string | null>(null);

  const navigateToApt = (name: string, lawdCd?: string, dong?: string) => {
    const query = lawdCd && dong ? `?lawdCd=${encodeURIComponent(lawdCd)}&dong=${encodeURIComponent(dong)}` : '';
    router.push(`/apt/${encodeURIComponent(name)}${query}`);
  };

  const handleSelect = (result: ApartmentSearchResult) => {
    setConnectFailed(null);
    const services = (window as any).kakao?.maps?.services;
    if (!services) {
      navigateToApt(result.name);
      return;
    }
    const geocoder = new services.Geocoder();
    geocoder.coord2RegionCode(result.lng, result.lat, async (regionResult: any, status: any) => {
      const region = status === services.Status.OK ? regionResult.find((r: any) => r.region_type === 'B') : null;
      if (!region) {
        navigateToApt(result.name);
        return;
      }
      const lawdCd = region.code.substring(0, 5);
      const dong = region.region_3depth_name;

      setVerifying(true);
      try {
        const res = await fetch(
          `/api/apt/${encodeURIComponent(result.name)}?type=apt&period=12&lawdCd=${encodeURIComponent(lawdCd)}&dong=${encodeURIComponent(dong)}`
        );
        const data = await res.json();
        const hasTrades = Array.isArray(data.trades) && data.trades.length > 0;
        setVerifying(false);
        if (hasTrades) {
          navigateToApt(result.name, lawdCd, dong);
        } else {
          setConnectFailed(result.name);
        }
      } catch {
        setVerifying(false);
        navigateToApt(result.name, lawdCd, dong);
      }
    });
  };

  return (
    <div>
      <div className={styles.searchBarWrap}>
        <span className={styles.searchBarIcon}>🔍</span>
        <ApartmentAutocomplete
          onSelect={handleSelect}
          placeholder="아파트 이름을 검색하세요"
          inputStyle={{
            border: 'none',
            borderRadius: '999px',
            background: 'transparent',
            padding: '0.85rem 1.1rem 0.85rem 2.5rem',
            fontWeight: 600,
          }}
        />
      </div>

      {verifying && <div className={styles.searchStatusMsg}>확인 중...</div>}
      {connectFailed && !verifying && (
        <div className={styles.searchStatusMsg}>
          &apos;{connectFailed}&apos;의 실거래 정보를 정확히 연결하지 못했습니다. 다시 검색해보세요.
        </div>
      )}
    </div>
  );
}
