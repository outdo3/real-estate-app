'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
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

  const navigateToApt = (name: string, lawdCd?: string, dong?: string, aptSeq?: string | null) => {
    if (!lawdCd || !dong) {
      router.push(`/apt/${encodeURIComponent(name)}`);
      return;
    }
    const qs = new URLSearchParams({ lawdCd, dong });
    if (aptSeq) qs.set('aptSeq', aptSeq);
    router.push(`/apt/${encodeURIComponent(name)}?${qs.toString()}`);
  };

  const handleSelect = (result: ApartmentSearchResult) => {
    setConnectFailed(null);
    
    // If it's a REGION, go to map
    if (result.type === 'REGION') {
      router.push(`/map?lat=${result.lat}&lng=${result.lng}`);
      return;
    }

    // It's an APARTMENT
    if (result.lawdCd && result.dong) {
      setVerifying(true);
      const aptSeqParam = result.aptSeq ? `&aptSeq=${encodeURIComponent(result.aptSeq)}` : '';
      fetch(
        `/api/apt/${encodeURIComponent(result.name)}/verify?dong=${encodeURIComponent(result.dong)}${aptSeqParam}`
      )
        .then(res => res.json())
        .then((data: { hasTrades: boolean; hasUnitTypes: boolean }) => {
          setVerifying(false);
          if (data.hasTrades || data.hasUnitTypes) {
            navigateToApt(result.name, result.lawdCd!, result.dong!, result.aptSeq);
          } else {
            setConnectFailed(result.name);
          }
        })
        .catch(() => {
          setVerifying(false);
          navigateToApt(result.name, result.lawdCd!, result.dong!, result.aptSeq);
        });
    } else {
      navigateToApt(result.name);
    }
  };

  return (
    <div>
      <div className={styles.searchBarWrap}>
        <Search className={styles.searchBarIcon} strokeWidth={2} />
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
          &apos;{connectFailed}&apos;의 최근 실거래 정보를 아직 확인하지 못했습니다.
        </div>
      )}
    </div>
  );
}
