'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRegion, RegionState } from '@/contexts/RegionContext';
import { REGCODE_PROXY, resolveRegionNameByLawdCd } from '@/lib/region-utils';
import ApartmentAutocomplete, { ApartmentSearchResult } from '@/components/ApartmentAutocomplete';
import styles from './RegionSelectModal.module.css';
import { buildRegionDisplayName } from '@/lib/region-display-name';
import { getSidoRegions, REGION_SIDOS } from '@/lib/region/registry';
import { isPublicRegionAllowed, isSidoPubliclyHidden, isSidoWholeQuerySupported } from '@/lib/region/enablement';

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
  const [modalDongs, setModalDongs] = useState<RegionOption[]>([]);
  const [selectedSido, setSelectedSido] = useState<RegionOption | null>(null);
  const [selectedSigungu, setSelectedSigungu] = useState<RegionOption | null>(null);
  const [regionLoading, setRegionLoading] = useState(false);
  const [dongLoadFailed, setDongLoadFailed] = useState(false);
  const dongRequest = useRef<AbortController | null>(null);

  // 모달이 열릴 때마다 항상 시도 선택 단계로 초기화 (기존 홈 화면과 동일한 UX)
  useEffect(() => {
    if (!isRegionModalOpen) return;
    setModalStep('sido');
    setSelectedSido(null);
    setSelectedSigungu(null);
    setModalDongs([]);
    setRegionLoading(false);
    setDongLoadFailed(false);
    return () => dongRequest.current?.abort();
  }, [isRegionModalOpen]);

  if (!isRegionModalOpen) return null;

  // Keep the existing 10-digit legal district code format at the UI boundary.
  const modalSidos = REGION_SIDOS
    .map((sido) => ({ code: sido.code.padEnd(10, '0'), name: sido.name }))
    .filter((s) => !isSidoPubliclyHidden(s.code.substring(0, 2)));
  const modalSigungus = selectedSido
    ? getSidoRegions(selectedSido.code.substring(0, 2))
      .map((region) => ({ code: region.lawdCd.padEnd(10, '0'), name: region.fullName }))
      .filter((item) => isPublicRegionAllowed(item.code.substring(0, 5), 'app'))
    : [];

  const handleClose = () => {
    closeRegionModal();
  };

  const selectSido = (sido: RegionOption) => {
    dongRequest.current?.abort();
    setSelectedSido(sido);
    setSelectedSigungu(null);
    setModalDongs([]);
    setRegionLoading(false);
    setDongLoadFailed(false);
    setModalStep('sigungu');
  };

  // STATISTICS REGION FILTER V2 — "부산광역시 전체"처럼 시군구를 특정하지 않는
  // 선택. 기존 dong 단계의 "OO구 전체" 버튼과 동일한 패턴을 시도 단계 바로
  // 다음(시군구 그리드 최상단)에 추가한다 — 시도 선택 자체를 바꾸지 않고
  // 그리드에 옵션만 하나 늘리는 최소 변경.
  const selectSidoAll = () => {
    if (!selectedSido) return;
    const sidoCode = selectedSido.code.substring(0, 2);
    // SEOUL_BETA_EXPOSURE_LEAK_CLOSE_V1 — 일부 구만 공개된 시도는 "시도 전체"를 만들지 않는다.
    // SEOUL_25_PUBLIC_BETA_PREP_V1 — 판정을 "일부만 열렸다"에서 "시도 단위 질의 경로가 있다"로 바꿨다.
    // 서울은 25구가 전부 열려도 시도 층이 닫혀 있어 "서울특별시 전체" 질의를 지원하지 않는다.
    if (!isSidoWholeQuerySupported(sidoCode)) return;
    finalize({
      lawdCd: null,
      sidoCode,
      dong: 'all',
      sido: selectedSido.name,
      sigungu: '',
      displayRegionName: buildRegionDisplayName({ sido: selectedSido.name, sigungu: '', dong: 'all' }),
    });
  };

  const selectSigungu = (sigungu: RegionOption) => {
    dongRequest.current?.abort();
    const request = new AbortController();
    dongRequest.current = request;
    setSelectedSigungu(sigungu);
    setModalDongs([]);
    setDongLoadFailed(false);
    setRegionLoading(true);
    setModalStep('dong');
    const sigunguCode = sigungu.code.substring(0, 5);
    fetch(`${REGCODE_PROXY}?regcode_pattern=${sigunguCode}*&is_ignore_zero=true`, { signal: request.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`읍면동 조회 HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!Array.isArray(data?.regcodes)) throw new Error('읍면동 응답 형식 오류');
        if (request.signal.aborted) return;
        const list = data.regcodes.filter((item: RegionOption) => item.code !== `${sigunguCode}00000`);
        setModalDongs(list);
        setDongLoadFailed(list.length === 0);
      })
      .catch(() => {
        if (!request.signal.aborted) setDongLoadFailed(true);
      })
      .finally(() => {
        if (!request.signal.aborted) setRegionLoading(false);
      });
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

    const sidoCode = lawdCd.substring(0, 2);
    if (!dong) {
      finalize({
        lawdCd,
        sidoCode,
        dong: 'all',
        sido: selectedSido.name,
        sigungu: sigunguShortName,
        displayRegionName: buildRegionDisplayName({ sido: selectedSido.name, sigungu: sigunguShortName, dong: 'all' }),
      });
      return;
    }

    const dongShortName = dong.name.split(' ').pop() || 'all';
    finalize({
      lawdCd,
      sidoCode,
      dong: dongShortName,
      sido: selectedSido.name,
      sigungu: sigunguShortName,
      displayRegionName: buildRegionDisplayName({ sido: selectedSido.name, sigungu: sigunguShortName, dong: dong.name }),
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
            sidoCode: lawdCd.substring(0, 2),
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
            sidoCode: place.lawdCd!.substring(0, 2),
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
          {modalStep === 'dong' && (regionLoading || dongLoadFailed) && (
            <p role="status" style={{ padding: '0 1rem', color: 'var(--text-secondary)' }}>
              {regionLoading ? '읍면동 목록을 불러오는 중입니다.' : '읍면동 목록을 불러오지 못했습니다. 아래에서 구 전체를 선택할 수 있습니다.'}
            </p>
          )}
          <div className={styles.grid}>
            {modalStep === 'sido' &&
              modalSidos.map((sido) => (
                <button key={sido.code} className={styles.gridBtn} onClick={() => selectSido(sido)}>
                  {sido.name}
                </button>
              ))}

            {modalStep === 'sigungu' && (
              <>
                {isSidoWholeQuerySupported(selectedSido?.code.substring(0, 2)) && (
                  <button className={styles.gridBtn} onClick={selectSidoAll}>
                    {selectedSido?.name} 전체
                  </button>
                )}
                {modalSigungus.map((sigungu) => (
                  <button key={sigungu.code} className={styles.gridBtn} onClick={() => selectSigungu(sigungu)}>
                    {sigungu.name.split(' ').slice(1).join(' ')}
                  </button>
                ))}
              </>
            )}

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
        </div>
      </div>
    </div>
  );
}
