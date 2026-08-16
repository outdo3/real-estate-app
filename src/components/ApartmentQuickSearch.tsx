'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ApartmentAutocomplete, { ApartmentSearchResult } from './ApartmentAutocomplete';
import { getRecentApartments, RecentApartment } from '@/lib/recent-apartments';

interface ApartmentQuickSearchProps {
  // 현재 보고 있는 단지 — "최근 본 단지" 목록에서 자기 자신을 빼기 위한 최소 식별자
  // (name+dong)와, [UI-C1-FIX] 카카오 검색 위치 bias 계산에 쓸 표시 주소.
  currentApt?: { name: string; dong: string; address?: string };
  onClose: () => void;
}

const itemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '0.7rem 0.75rem',
  borderRadius: '8px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
};

// [UI-C1] 상세페이지 전용 "다른 아파트 빠른 검색". 검색 자체는 기존
// ApartmentAutocomplete(카카오 키워드 검색, /map·/stats·RegionSelectModal에서 이미
// 쓰는 컴포넌트)를 그대로 재사용하고, 이 컴포넌트는 그 위에 (1) 검색어가 없을 때
// "최근 본 단지" 표시 (2) 결과가 0건일 때 안내 문구 (3) 선택 시 기존 canonical
// 상세 URL(`/apt/[name]?lawdCd=..&dong=..`, map "상세보기" 버튼과 동일한 형태)로
// 이동만 추가한다. 새 검색 시스템이 아니다.
//
// [UI-C1-FIX] 오매칭 방지를 위해 두 가지를 더한다:
// (1) 현재 단지 위치로 카카오 검색에 거리 bias를 줘서 동명 단지가 다른 지역에서
//     1순위로 잡히는 빈도를 줄인다(하드 반경 제한 아님).
// (2) 이동 직전, 이미 존재하는 실거래 API(/api/apt/[name])로 "이 이름+동으로 실제
//     연결되는 거래가 있는지" 가볍게 확인한다 — 없으면 다른 단지로 대체하지 않고
//     검색 실패를 그대로 안내한다("틀린 단지보다 검색 실패"가 최우선 원칙).
export default function ApartmentQuickSearch({ currentApt, onClose }: ApartmentQuickSearchProps) {
  const router = useRouter();
  const [recent, setRecent] = useState<RecentApartment[]>([]);
  const [queryState, setQueryState] = useState<{ keyword: string; hasResults: boolean }>({ keyword: '', hasResults: true });
  const [biasLocation, setBiasLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [verifying, setVerifying] = useState(false);
  const [connectFailed, setConnectFailed] = useState<string | null>(null);

  // localStorage는 클라이언트에서만 읽는다(SSR 중 접근 없음 — 하이드레이션 불일치 없음).
  useEffect(() => {
    setRecent(getRecentApartments());
  }, []);

  // [UI-C1-FIX] 현재 단지 주소를 좌표로 바꿔 검색 bias에 쓴다. ApartmentAutocomplete가
  // 자기 위치를 못 찾았을 때 내부적으로 쓰는 것과 동일한 Geocoder.addressSearch를
  // 재사용 — 새 지오코딩 방식을 만들지 않는다. 실패해도(주소 없음/API 실패) bias
  // 없이 기존처럼 동작한다(기능 저하 없음, 정확도만 완화되지 않음).
  useEffect(() => {
    if (!currentApt?.address) return;
    const tryGeocode = () => {
      if (!window.kakao?.maps?.services) return;
      window.kakao.maps.load(() => {
        const geocoder = new window.kakao.maps.services.Geocoder();
        geocoder.addressSearch(currentApt.address!, (result: any, status: any) => {
          if (status === window.kakao.maps.services.Status.OK && result[0]) {
            setBiasLocation({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
          }
        });
      });
    };
    // ApartmentAutocomplete가 이미 SDK를 로드하고 있을 것이므로(같은 페이지 안,
    // 검색창이 함께 마운트됨) 짧게 기다렸다 시도한다 — 실패해도 위 설명대로 무해하다.
    if (window.kakao?.maps) tryGeocode();
    else {
      const t = setTimeout(tryGeocode, 400);
      return () => clearTimeout(t);
    }
  }, []);

  // Android/브라우저 뒤로가기로 검색만 닫히고 상세페이지 자체는 이탈하지 않도록,
  // 이 오버레이가 열려 있는 동안만 history entry를 하나 쌓아두고 popstate에서 닫는다.
  useEffect(() => {
    window.history.pushState({ ejipQuickSearch: true }, '');
    const onPopState = () => onClose();
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const navigateToApt = (name: string, lawdCd?: string, dong?: string) => {
    const query = lawdCd && dong ? `?lawdCd=${encodeURIComponent(lawdCd)}&dong=${encodeURIComponent(dong)}` : '';
    onClose();
    router.push(`/apt/${encodeURIComponent(name)}${query}`);
  };

  const handleSelect = (result: ApartmentSearchResult) => {
    setConnectFailed(null);
    // ApartmentAutocomplete 내부 enrichTopResults()가 세대수/준공연도를 보강할 때 쓰는 것과
    // 동일한 좌표→법정동 역지오코딩 방식을 그대로 재사용한다 — 새 방식을 만들지 않는다.
    const services = (window as any).kakao?.maps?.services;
    if (!services) {
      navigateToApt(result.name);
      return;
    }
    const geocoder = new services.Geocoder();
    geocoder.coord2RegionCode(result.lng, result.lat, async (regionResult: any, status: any) => {
      const region = status === services.Status.OK ? regionResult.find((r: any) => r.region_type === 'B') : null;
      if (!region) {
        // 동을 못 얻은 경우 — 다른 동/지역으로 대체하지 않고 이름만으로 이동한다
        // (기존 apt-client.tsx가 이미 처리하는 폴백 경로, 새로 만들지 않음).
        navigateToApt(result.name);
        return;
      }
      const lawdCd = region.code.substring(0, 5);
      const dong = region.region_3depth_name;

      // [UI-C1-FIX] 이동 전 가벼운 확인 — 이미 있는 실거래 API를 최소 기간(1년)으로만
      // 호출해 이 이름+동으로 실제 연결되는 거래가 있는지 본다. 새 API를 만들지 않았다.
      setVerifying(true);
      try {
        const res = await fetch(`/api/apt/${encodeURIComponent(result.name)}?type=apt&period=12&lawdCd=${encodeURIComponent(lawdCd)}&dong=${encodeURIComponent(dong)}`);
        const data = await res.json();
        const hasTrades = Array.isArray(data.trades) && data.trades.length > 0;
        setVerifying(false);
        if (hasTrades) {
          navigateToApt(result.name, lawdCd, dong);
        } else {
          // 다른 단지로 대체하지 않는다 — 정직하게 실패를 알리고 검색을 계속하게 한다.
          setConnectFailed(result.name);
        }
      } catch {
        // 확인 자체가 실패(네트워크 등)해도 다른 단지로 보내지 않는다 — 원래 이동
        // 시도했을 때(기존 UI-C1 동작)와 동일하게 이름 기반으로만 이동한다.
        setVerifying(false);
        navigateToApt(result.name, lawdCd, dong);
      }
    });
  };

  const currentKey = currentApt ? `${currentApt.name}|${currentApt.dong}` : null;
  const visibleRecent = recent.filter((r) => `${r.name}|${r.dong}` !== currentKey);

  const showRecent = !queryState.keyword.trim() && !connectFailed;
  const showNoResults = !showRecent && !queryState.hasResults && !connectFailed;

  return (
    <div>
      <ApartmentAutocomplete
        onSelect={handleSelect}
        onQueryStateChange={(state) => {
          setConnectFailed(null);
          setQueryState(state);
        }}
        placeholder="🔍 아파트 이름을 검색하세요"
        autoFocus
        onSubmit={undefined}
        biasLocation={biasLocation}
      />

      {verifying && (
        <div style={{ marginTop: '1rem', padding: '1rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          확인 중...
        </div>
      )}

      {connectFailed && !verifying && (
        <div style={{ marginTop: '1rem', padding: '1rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          &apos;{connectFailed}&apos;의 실거래 정보를 정확히 연결하지 못했습니다.<br />다시 검색해보세요.
        </div>
      )}

      {showNoResults && !verifying && (
        <div style={{ marginTop: '1rem', padding: '1.5rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          검색 결과가 없습니다.
        </div>
      )}

      {showRecent && !verifying && (
        <div style={{ marginTop: '1.25rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            최근 본 단지
          </div>
          {visibleRecent.length === 0 ? (
            <div style={{ padding: '1rem 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              최근 본 단지가 없습니다. 아파트 이름을 검색해보세요.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {visibleRecent.map((r) => (
                <button
                  key={`${r.name}|${r.dong}`}
                  type="button"
                  style={itemStyle}
                  onClick={() => navigateToApt(r.name, r.lawdCd, r.dong)}
                  onMouseOver={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>{r.name}</div>
                  {r.address && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{r.address}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
