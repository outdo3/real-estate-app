'use client';

import React, { useRef, useState, useEffect } from 'react';

export interface ApartmentSearchResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface ApartmentAutocompleteProps {
  onSelect: (result: ApartmentSearchResult) => void;
  placeholder?: string;
}

const SCRIPT_ID = 'kakao-map-script-main';
// 상위 몇 개 결과까지 실데이터(세대수/준공연도/건물유형)를 보강할지. 이 조회는 동/법정동
// 역지오코딩 + /api/apt/[name]/info(외부 스크래핑 포함) 왕복이 있어 전체 결과에 다 걸면
// 타이핑마다 과도한 외부 호출이 발생한다 — 상위 3개로 제한.
const ENRICH_COUNT = 3;

interface Enrichment {
  households: string | null;
  buildYear: string | null;
  buildingType: string | null;
}

// 카카오 장소 키워드 검색(SearchFilterBar.tsx와 같은 방식)으로 아파트 단지를 찾는 자동완성.
// 카카오 로컬 API 자체는 세대수/준공연월/건물유형을 제공하지 않는다 — 그 값이 필요하면
// 이 앱이 이미 갖고 있는 실제 데이터 소스(/api/apt/[name]/info, 단지 상세페이지가 쓰는 것과
// 동일한 라우트)를 상위 결과에 한해 추가로 조회해서 채운다. 값을 지어내지 않는다.
export default function ApartmentAutocomplete({ onSelect, placeholder }: ApartmentAutocompleteProps) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [enrichment, setEnrichment] = useState<Record<string, Enrichment | 'loading' | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const enrichTopResults = (apartments: any[]) => {
    if (!window.kakao?.maps?.services) return;
    const geocoder = new window.kakao.maps.services.Geocoder();

    apartments.slice(0, ENRICH_COUNT).forEach((place) => {
      const key = place.id;
      setEnrichment((prev) => ({ ...prev, [key]: 'loading' }));

      geocoder.coord2RegionCode(place.x, place.y, (regionResult: any, regionStatus: any) => {
        if (regionStatus !== window.kakao.maps.services.Status.OK) {
          setEnrichment((prev) => ({ ...prev, [key]: null }));
          return;
        }
        const region = regionResult.find((r: any) => r.region_type === 'B');
        if (!region) {
          setEnrichment((prev) => ({ ...prev, [key]: null }));
          return;
        }
        const lawdCd = region.code.substring(0, 5);
        const dong = region.region_3depth_name;

        fetch(`/api/apt/${encodeURIComponent(place.place_name)}/info?dong=${encodeURIComponent(dong)}&lawdCd=${encodeURIComponent(lawdCd)}`)
          .then((res) => res.json())
          .then((data) => {
            const info = data?.info as Record<string, string> | null;
            if (!info) {
              setEnrichment((prev) => ({ ...prev, [key]: null }));
              return;
            }
            setEnrichment((prev) => ({
              ...prev,
              [key]: {
                households: info['세대수'] || null,
                buildYear: info['사용승인일'] || null,
                buildingType: info['주용도'] || null,
              },
            }));
          })
          .catch(() => setEnrichment((prev) => ({ ...prev, [key]: null })));
      });
    });
  };

  useEffect(() => {
    if (!keyword.trim()) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(() => {
      const runSearch = () => {
        if (!window.kakao?.maps?.services) return;
        const ps = new window.kakao.maps.services.Places();
        ps.keywordSearch(keyword, (data: any, status: any) => {
          if (status === window.kakao.maps.services.Status.OK) {
            // 아파트 카테고리만 남긴다(단지 검색이 목적이라 역/상점 등은 노이즈).
            const apartments = data.filter((p: any) => p.category_name && p.category_name.includes('아파트'));
            setEnrichment({});
            setResults(apartments);
            setShowDropdown(apartments.length > 0);
            enrichTopResults(apartments);
          } else {
            setResults([]);
            setShowDropdown(false);
          }
        });
      };

      if (window.kakao && window.kakao.maps) {
        window.kakao.maps.load(runSearch);
      } else {
        const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
        if (!apiKey) return;
        let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement;
        if (!script) {
          script = document.createElement('script');
          script.id = SCRIPT_ID;
          script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer&autoload=false`;
          document.head.appendChild(script);
        }
        script.addEventListener('load', () => window.kakao.maps.load(runSearch), { once: true });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [keyword]);

  const handleSelect = (place: any) => {
    setShowDropdown(false);
    setKeyword(place.place_name);
    onSelect({
      name: place.place_name,
      address: place.road_address_name || place.address_name || '',
      lat: parseFloat(place.y),
      lng: parseFloat(place.x),
    });
  };

  const renderEnrichmentLine = (place: any) => {
    const e = enrichment[place.id];
    if (e === undefined) return null;
    if (e === 'loading') return <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>상세정보 조회 중...</div>;
    if (e === null) return null;
    const parts = [
      e.households ? (e.households.includes('세대') ? e.households : `${e.households}세대`) : null,
      e.buildYear ? `${e.buildYear}년 준공` : null,
      e.buildingType,
    ].filter(Boolean);
    if (parts.length === 0) return null;
    return <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{parts.join(' · ')}</div>;
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
        placeholder={placeholder || '아파트 단지명 검색'}
        style={{
          width: '100%',
          padding: '0.6rem 1rem',
          border: '1px solid var(--border-color)',
          borderRadius: '99px',
          outline: 'none',
          fontSize: '1rem',
          boxSizing: 'border-box',
        }}
      />
      {showDropdown && (
        <ul
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'white',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
            listStyle: 'none',
            margin: 0,
            padding: '0.4rem',
            maxHeight: '360px',
            overflowY: 'auto',
            zIndex: 20,
          }}
        >
          {results.map((place, i) => (
            <li
              key={`${place.id || place.place_name}-${i}`}
              onClick={() => handleSelect(place)}
              style={{
                padding: '0.6rem 0.75rem',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = '#f8fafc')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{place.place_name}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{place.road_address_name || place.address_name}</div>
              {renderEnrichmentLine(place)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
