'use client';

import React, { useEffect, useState } from 'react';
import { useRegion, RegionState } from '@/contexts/RegionContext';
import { REGCODE_PROXY, resolveRegionNameByLawdCd } from '@/lib/region-utils';
import ApartmentAutocomplete, { ApartmentSearchResult } from '@/components/ApartmentAutocomplete';
import styles from './RegionSelectModal.module.css';

type RegionOption = { code: string; name: string };

interface RegionSelectModalProps {
  /**
   * 아파트명 등 키워드 검색 시, 페이지가 자체적으로 처리(예: 홈 화면의 지도 마커
   * 강조)하고 싶을 때 사용. true를 반환하면 모달은 지역 상태를 건드리지 않고
   * 그대로 닫히고, false/미제공이면 모달이 검색 결과 좌표를 행정구역으로
   * 역지오코딩해 일반적인 지역 선택으로 처리한다.
   */
  onKeywordMatch?: (keyword: string) => boolean;
  /**
   * 지역이 확정(그리드 선택 또는 키워드 역지오코딩)된 직후 호출된다.
   * 홈 화면은 이를 이용해 지도 중심을 해당 지역으로 이동시킨다.
   * exactCoords가 있으면(단지 검색으로 확정된 경우) 그 좌표가 검색한 단지 자체의 정확한
   * 위치이므로, 호출부는 이를 그대로 지도 중심으로 써야 한다 — 동 이름을 다시
   * addressSearch로 지오코딩하면 그 동의 대표 지점(엉뚱한 곳)으로 튈 수 있다.
   */
  onRegionFinalize?: (region: RegionState, exactCoords?: { lat: number; lng: number }) => void;
}

// 아실 스타일 전면 지역 선택 모달: 시도 > 시군구 > 읍면동 2열 그리드.
// 실거래가(홈)/시장통계/학군정보 등 모든 페이지가 이 하나의 컴포넌트를 공유하며,
// RegionContext를 통해 선택 결과를 전역으로 반영한다.
export default function RegionSelectModal({ onKeywordMatch, onRegionFinalize }: RegionSelectModalProps) {
  const { isRegionModalOpen, closeRegionModal, setRegion } = useRegion();

  const [modalStep, setModalStep] = useState<'sido' | 'sigungu' | 'dong'>('sido');
  const [modalSidos, setModalSidos] = useState<RegionOption[]>([]);
  const [modalSigungus, setModalSigungus] = useState<RegionOption[]>([]);
  const [modalDongs, setModalDongs] = useState<RegionOption[]>([]);
  const [selectedSido, setSelectedSido] = useState<RegionOption | null>(null);
  const [selectedSigungu, setSelectedSigungu] = useState<RegionOption | null>(null);
  const [regionLoading, setRegionLoading] = useState(false);

  // 모달이 열릴 때마다 항상 시도 선택 단계로 초기화 (기존 홈 화면과 동일한 UX)
  useEffect(() => {
    if (!isRegionModalOpen) return;
    setModalStep('sido');
    setSelectedSido(null);
    setSelectedSigungu(null);
    if (modalSidos.length === 0) {
      setRegionLoading(true);
      fetch(`${REGCODE_PROXY}?regcode_pattern=*00000000`)
        .then((res) => res.json())
        .then((data) => setModalSidos(data.regcodes || []))
        .catch((err) => console.error('시도 목록 조회 실패', err))
        .finally(() => setRegionLoading(false));
    }
    // modalSidos는 의도적으로 deps에서 제외: 모달이 "열릴 때"만 초기화/캐시 확인을
    // 수행해야 하며, fetch 완료로 modalSidos가 채워질 때 이 effect가 다시 돌면서
    // 진행 중이던 시군구/읍면동 선택을 되돌리면 안 된다.
  }, [isRegionModalOpen]);

  if (!isRegionModalOpen) return null;

  const handleClose = () => {
    closeRegionModal();
  };

  const selectSido = (sido: RegionOption) => {
    setSelectedSido(sido);
    setSelectedSigungu(null);
    setModalDongs([]);
    setRegionLoading(true);
    const sidoCode = sido.code.substring(0, 2);
    fetch(`${REGCODE_PROXY}?regcode_pattern=${sidoCode}*00000&is_ignore_zero=true`)
      .then((res) => res.json())
      .then((data) => {
        const list = (data.regcodes || []).filter((item: RegionOption) => item.code.substring(0, 5) !== `${sidoCode}000`);
        setModalSigungus(list);
        setModalStep('sigungu');
      })
      .catch((err) => console.error('시군구 목록 조회 실패', err))
      .finally(() => setRegionLoading(false));
  };

  const selectSigungu = (sigungu: RegionOption) => {
    setSelectedSigungu(sigungu);
    setRegionLoading(true);
    const sigunguCode = sigungu.code.substring(0, 5);
    fetch(`${REGCODE_PROXY}?regcode_pattern=${sigunguCode}*&is_ignore_zero=true`)
      .then((res) => res.json())
      .then((data) => {
        const list = (data.regcodes || []).filter((item: RegionOption) => item.code !== `${sigunguCode}00000`);
        setModalDongs(list);
        setModalStep('dong');
      })
      .catch((err) => console.error('읍면동 목록 조회 실패', err))
      .finally(() => setRegionLoading(false));
  };

  const finalize = (next: RegionState, exactCoords?: { lat: number; lng: number }) => {
    setRegion(next);
    closeRegionModal();
    onRegionFinalize?.(next, exactCoords);
  };

  const selectDong = (dong: RegionOption | null) => {
    if (!selectedSido || !selectedSigungu) return;
    const lawdCd = selectedSigungu.code.substring(0, 5);
    const sigunguShortName = selectedSigungu.name.split(' ').slice(1).join(' ');

    if (!dong) {
      finalize({
        lawdCd,
        dong: 'all',
        sido: selectedSido.name,
        sigungu: sigunguShortName,
        displayRegionName: `${selectedSido.name} ${sigunguShortName}`,
      });
      return;
    }

    const dongShortName = dong.name.split(' ').pop() || 'all';
    finalize({
      lawdCd,
      dong: dongShortName,
      sido: selectedSido.name,
      sigungu: sigunguShortName,
      displayRegionName: dong.name,
    });
  };

  // 좌표(경도, 위도) -> 행정구역 역지오코딩 후 지역을 확정한다. 키워드 검색으로 찾은 좌표든
  // 자동완성에서 고른 단지의 좌표든 이 한 함수로 처리한다.
  const reverseGeocodeAndFinalize = (lng: number, lat: number, addressNameFallback: string) => {
    if (!window.kakao || !window.kakao.maps || !window.kakao.maps.services) return;
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.coord2RegionCode(lng, lat, (result: any, geoStatus: any) => {
      if (geoStatus !== window.kakao.maps.services.Status.OK) return;
      const region = result.find((r: any) => r.region_type === 'B');
      if (!region) return;
      const lawdCd = region.code.substring(0, 5);

      // 시/군/구 이름을 우리 지역코드 프록시 기준으로 다시 조회해, REGION_DATA 및
      // 다른 화면들과 동일한 표기(예: "부산광역시 서구")를 보장한다.
      // (카카오의 region_1depth_name은 종종 "서울"처럼 축약된 이름을 반환해
      //  전역 상태의 sido 값과 형식이 어긋날 수 있다.)
      resolveRegionNameByLawdCd(lawdCd).then((resolved) => {
        finalize(
          {
            lawdCd,
            dong: 'all',
            sido: resolved?.sido || region.address_name,
            sigungu: resolved?.sigungu || '',
            displayRegionName: region.address_name || addressNameFallback,
          },
          // 방금 이 좌표(lat,lng) 자체로 역지오코딩했으니, 호출부(홈 화면)가 동 이름을
          // 또 지오코딩해서 대표 지점으로 튀지 않도록 정확한 좌표를 그대로 전달한다.
          { lat, lng }
        );
      });
    });
  };

  // 자동완성 드롭다운에서 항목을 골랐을 때: 이미 좌표를 알고 있으니 바로 역지오코딩한다.
  const handlePlaceSelect = (place: ApartmentSearchResult) => {
    if (onKeywordMatch && onKeywordMatch(place.name)) {
      closeRegionModal();
      return;
    }
    
    if (place.lawdCd) {
      resolveRegionNameByLawdCd(place.lawdCd).then((resolved) => {
        finalize(
          {
            lawdCd: place.lawdCd!,
            dong: place.type === 'REGION' ? 'all' : (place.dong || 'all'),
            sido: resolved?.sido || place.sido || '',
            sigungu: resolved?.sigungu || place.sigungu || '',
            displayRegionName: place.address || place.name,
          },
          { lat: place.lat, lng: place.lng }
        );
      });
    } else {
      reverseGeocodeAndFinalize(place.lng, place.lat, place.address || place.name);
    }
  };

  // 드롭다운에서 고르지 않고 Enter를 눌렀을 때(정확한 지역명 등): 카카오 키워드 검색으로
  // 첫 결과를 찾아 같은 방식으로 처리한다.
  const handleKeywordSubmit = (keyword: string) => {
    if (!keyword.trim()) return;

    if (onKeywordMatch && onKeywordMatch(keyword)) {
      closeRegionModal();
      return;
    }

    if (!window.kakao || !window.kakao.maps || !window.kakao.maps.services) return;

    const ps = new window.kakao.maps.services.Places();
    ps.keywordSearch(keyword, (data: any, status: any) => {
      if (status !== window.kakao.maps.services.Status.OK || !data[0]) return;
      reverseGeocodeAndFinalize(parseFloat(data[0].x), parseFloat(data[0].y), data[0].address_name);
    });
  };

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.content} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div style={{ flex: 1 }}>
            <ApartmentAutocomplete
              autoFocus
              categoryFilter={null}
              placeholder="단지명, 동이름, 지역명을 입력해주세요."
              onSelect={handlePlaceSelect}
              onSubmit={handleKeywordSubmit}
              inputStyle={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem 1rem' }}
            />
          </div>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="검색 닫기">
            ×
          </button>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${modalStep === 'sido' ? styles.tabActive : ''}`}
            onClick={() => setModalStep('sido')}
          >
            {selectedSido ? selectedSido.name : '시도 선택'}
          </button>
          <span className={styles.tabArrow}>›</span>
          <button
            className={`${styles.tab} ${modalStep === 'sigungu' ? styles.tabActive : ''}`}
            disabled={!selectedSido}
            onClick={() => selectedSido && setModalStep('sigungu')}
          >
            {selectedSigungu ? selectedSigungu.name.split(' ').slice(1).join(' ') : '시군구 선택'}
          </button>
          <span className={styles.tabArrow}>›</span>
          <button
            className={`${styles.tab} ${modalStep === 'dong' ? styles.tabActive : ''}`}
            disabled={!selectedSigungu}
            onClick={() => selectedSigungu && setModalStep('dong')}
          >
            읍면동 선택
          </button>
        </div>

        <div className={styles.gridWrapper}>
          {regionLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>불러오는 중...</div>
          ) : (
            <div className={styles.grid}>
              {modalStep === 'sido' &&
                modalSidos.map((sido) => (
                  <button key={sido.code} className={styles.gridBtn} onClick={() => selectSido(sido)}>
                    {sido.name}
                  </button>
                ))}

              {modalStep === 'sigungu' &&
                modalSigungus.map((sigungu) => (
                  <button key={sigungu.code} className={styles.gridBtn} onClick={() => selectSigungu(sigungu)}>
                    {sigungu.name.split(' ').slice(1).join(' ')}
                  </button>
                ))}

              {modalStep === 'dong' && (
                <>
                  <button className={styles.gridBtn} onClick={() => selectDong(null)}>
                    {selectedSigungu?.name.split(' ').slice(1).join(' ') || ''} 전체
                  </button>
                  {modalDongs.map((dong) => (
                    <button key={dong.code} className={styles.gridBtn} onClick={() => selectDong(dong)}>
                      {dong.name.split(' ').pop()}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
