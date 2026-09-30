'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Map as KakaoMap, CustomOverlayMap } from 'react-kakao-maps-sdk';
import styles from './page.module.css';
import type { NearbyMarketApiResponse, NearbyMapApartment } from './nearby-market-section';

// /map/page.tsx, KakaoMapEmbed.tsx와 동일한 script id — 이미 두 곳에서 검증된 관례를
// 그대로 재사용해 어느 페이지를 먼저 방문했든 SDK 스크립트가 중복 주입되지 않는다
// (docs/development/23-presale-map-design.md §3).
const KAKAO_SCRIPT_ID = 'kakao-map-script-main';
// 지도 260px 높이 안에서 6개 마커 라벨이 서로 겹치는 걸 완전히 막을 수는 없어(클러스터링은
// V1 범위 밖, 문서23 §23), bounds 계산 시 여백을 넉넉히 준다.
const BOUNDS_PADDING = 40;

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${(Math.round(km * 10) / 10)}km`;
}

function formatManwon(v: number): string {
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  if (eok === 0) return `${man.toLocaleString()}만원`;
  if (man === 0) return `${eok}억`;
  return `${eok}억 ${man.toLocaleString()}만원`;
}

interface PresaleNearbyMapProps {
  houseName: string;
  latitude: number | null;
  longitude: number | null;
  marketData?: NearbyMarketApiResponse;
  marketLoading: boolean;
  selectedHouseTypeId: number | null;
}

export default function PresaleNearbyMap({
  houseName,
  latitude,
  longitude,
  marketData,
  marketLoading,
  selectedHouseTypeId,
}: PresaleNearbyMapProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<number | 'presale' | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // P2-D4-B4 §13 — 지도 섹션이 viewport 근처(200px 여유)에 왔을 때만 SDK 로딩을 시작한다.
  // B3의 nearby-market cold 요청과 Kakao SDK 다운로드가 페이지 진입 즉시 경쟁하지 않도록.
  useEffect(() => {
    if (!sectionRef.current || typeof IntersectionObserver === 'undefined') {
      setInView(true); // 구형 환경 등 지원 안 되면 즉시 로드로 폴백(빈 화면 방지)
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || latitude == null || longitude == null) return;

    if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
      setSdkReady(true);
      return;
    }

    let script = document.getElementById(KAKAO_SCRIPT_ID) as HTMLScriptElement | null;
    const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

    if (!script) {
      if (!apiKey) {
        setSdkError('지도 API 키가 설정되지 않았습니다.');
        return;
      }
      script = document.createElement('script');
      script.id = KAKAO_SCRIPT_ID;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer&autoload=false`;
      script.async = true;
      document.head.appendChild(script);
    }

    const handleScriptError = () => setSdkError('카카오맵 스크립트를 불러오지 못했습니다.');
    script.addEventListener('error', handleScriptError);

    const checkKakao = setInterval(() => {
      if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
        clearInterval(checkKakao);
        setSdkReady(true);
      } else if (window.kakao && window.kakao.maps) {
        clearInterval(checkKakao);
        window.kakao.maps.load(() => setSdkReady(true));
      }
    }, 200);

    const timeout = setTimeout(() => {
      clearInterval(checkKakao);
      setSdkReady((ready) => {
        if (!ready) setSdkError('지도를 불러오는 데 시간이 너무 오래 걸립니다.');
        return ready;
      });
    }, 10000);

    return () => {
      clearInterval(checkKakao);
      clearTimeout(timeout);
      script?.removeEventListener('error', handleScriptError);
    };
  }, [inView, latitude, longitude]);

  const nearbyApartments: (NearbyMapApartment & { latitude: number; longitude: number })[] = useMemo(() => {
    if (!marketData?.success || !marketData.data) return [];
    return marketData.data.nearbyApartments.filter(
      (a): a is NearbyMapApartment & { latitude: number; longitude: number } => a.latitude != null && a.longitude != null
    );
  }, [marketData]);

  // 선택된 주택형의 comparisons에서 이 아파트의 recentMedianPrice를 찾는다 — 새 API 호출
  // 없이 B3와 이미 공유 중인 데이터에서 client-side로만 연결한다(문서23 §9~10).
  const priceByApartmentId = useMemo(() => {
    const map = new Map<number, number>();
    if (!marketData?.success || !marketData.data || selectedHouseTypeId == null) return map;
    const houseType = marketData.data.houseTypes.find((h) => h.houseTypeDetailId === selectedHouseTypeId);
    if (!houseType) return map;
    for (const c of houseType.comparisons) {
      if (c.recentMedianPrice != null) map.set(c.apartment.id, c.recentMedianPrice);
    }
    return map;
  }, [marketData, selectedHouseTypeId]);

  // 지도 인스턴스 준비 + marker 좌표 확정 후 bounds fit(고정 zoom 아님, 문서23 §13/§22 —
  // adaptive radius로 60m~2.38km까지 실측 편차가 커서 고정 zoom은 부적절).
  useEffect(() => {
    if (!mapInstance || !window.kakao?.maps || latitude == null || longitude == null) return;
    const bounds = new window.kakao.maps.LatLngBounds();
    bounds.extend(new window.kakao.maps.LatLng(latitude, longitude));
    for (const apt of nearbyApartments) {
      bounds.extend(new window.kakao.maps.LatLng(apt.latitude, apt.longitude));
    }
    mapInstance.setBounds(bounds, BOUNDS_PADDING);
  }, [mapInstance, latitude, longitude, nearbyApartments]);

  if (latitude == null || longitude == null) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>위치와 주변 단지</h2>
        <p className={styles.emptyText}>정확한 위치정보가 없어 지도를 표시할 수 없습니다.</p>
      </section>
    );
  }

  const kakaoLinkHref = `https://map.kakao.com/link/map/${encodeURIComponent(houseName)},${latitude},${longitude}`;
  const selectedApt = nearbyApartments.find((a) => a.id === selectedMarkerId) ?? null;

  return (
    <section className={styles.section} ref={sectionRef}>
      <div className={styles.nearbyHeaderRow}>
        <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
          위치와 주변 단지
        </h2>
        <button
          type="button"
          className={styles.infoButton}
          aria-expanded={infoOpen}
          aria-label="지도 안내"
          onClick={() => setInfoOpen((v) => !v)}
        >
          ⓘ
        </button>
      </div>

      {infoOpen && (
        <p className={styles.infoPanel}>
          분양단지(초록색)와 반경 내 주변 아파트(최대 5곳)의 위치를 보여줍니다. 실거래 비교는 아래
          &quot;주변 아파트 실거래 비교&quot; 섹션을 참고해주세요.
        </p>
      )}

      {sdkError ? (
        <div className={styles.mapStateBox}>
          <p style={{ margin: 0 }}>지도를 불러오지 못했습니다.</p>
          <a href={kakaoLinkHref} target="_blank" rel="noopener noreferrer" className={styles.retryBtn}>
            카카오맵에서 보기
          </a>
        </div>
      ) : !inView || !sdkReady || marketLoading ? (
        <div className={styles.mapStateBox}>지도를 불러오는 중입니다...</div>
      ) : (
        <>
          <div className={styles.mapContainer}>
            <KakaoMap
              center={{ lat: latitude, lng: longitude }}
              style={{ width: '100%', height: '100%' }}
              level={5}
              onCreate={setMapInstance}
              onClick={() => setSelectedMarkerId(null)}
            >
              <CustomOverlayMap position={{ lat: latitude, lng: longitude }} yAnchor={1} zIndex={selectedMarkerId === 'presale' ? 20 : 10}>
                <div
                  style={{ transform: 'translateY(-8px)' }}
                  className={styles.mapMarkerPresale}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedMarkerId('presale');
                  }}
                >
                  분양
                </div>
              </CustomOverlayMap>

              {nearbyApartments.map((apt) => {
                const selected = apt.id === selectedMarkerId;
                return (
                  <CustomOverlayMap
                    key={apt.id}
                    position={{ lat: apt.latitude as number, lng: apt.longitude as number }}
                    yAnchor={1}
                    zIndex={selected ? 20 : 1}
                  >
                    <div
                      className={`${styles.mapMarkerNearby} ${selected ? styles.mapMarkerNearbySelected : ''}`}
                      onClick={(e) => {
                        // 카카오 지도 컨테이너에 등록된 onClick(빈 곳 클릭 시 선택 해제)이
                        // 마커 클릭 시 네이티브 이벤트 버블링으로 같이 발동해 곧바로
                        // 선택이 풀리는 문제가 있어 전파를 막는다.
                        e.stopPropagation();
                        setSelectedMarkerId(apt.id);
                      }}
                    >
                      {apt.name.length > 6 ? `${apt.name.slice(0, 6)}…` : apt.name}
                    </div>
                  </CustomOverlayMap>
                );
              })}
            </KakaoMap>

            {selectedMarkerId === 'presale' ? (
              <div className={styles.mapPopup} role="status">
                <button
                  type="button"
                  className={styles.mapPopupClose}
                  aria-label="닫기"
                  onClick={() => setSelectedMarkerId(null)}
                >
                  ✕
                </button>
                <p className={styles.mapPopupTitle}>{houseName}</p>
                <p className={styles.mapPopupMeta}>분양 위치</p>
              </div>
            ) : selectedApt && (
              <div className={styles.mapPopup} role="status">
                <button
                  type="button"
                  className={styles.mapPopupClose}
                  aria-label="닫기"
                  onClick={() => setSelectedMarkerId(null)}
                >
                  ✕
                </button>
                <p className={styles.mapPopupTitle}>{selectedApt.name}</p>
                <p className={styles.mapPopupMeta}>
                  {formatDistance(selectedApt.distanceKm)}
                  {selectedApt.buildYear != null ? ` · ${selectedApt.buildYear}년 준공` : ''}
                </p>
                {priceByApartmentId.has(selectedApt.id) && (
                  <p className={styles.mapPopupPrice}>
                    최근 거래 대표가격 {formatManwon(priceByApartmentId.get(selectedApt.id) as number)}
                  </p>
                )}
              </div>
            )}
          </div>

          {nearbyApartments.length === 0 && (
            <p className={styles.emptyText} style={{ marginTop: '0.6rem' }}>
              반경 3km 내 표시할 주변 단지가 없습니다.
            </p>
          )}

          <a href={kakaoLinkHref} target="_blank" rel="noopener noreferrer" className={styles.stateLink} style={{ marginTop: '0.75rem', display: 'inline-block' }}>
            카카오맵에서 크게 보기 ↗
          </a>
        </>
      )}
    </section>
  );
}
