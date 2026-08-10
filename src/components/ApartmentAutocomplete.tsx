'use client';

import React, { useEffect, useRef, useState } from 'react';

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

// 카카오 장소 키워드 검색(SearchFilterBar.tsx와 같은 방식)으로 아파트 단지를 찾는 자동완성.
// 카카오 로컬 API는 세대수/준공연월 같은 부동산 속성을 제공하지 않는다 — 그 값을 지어내는
// 대신 실제로 받을 수 있는 단지명/주소만 드롭다운에 보여준다.
export default function ApartmentAutocomplete({ onSelect, placeholder }: ApartmentAutocompleteProps) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
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
            setResults(apartments);
            setShowDropdown(apartments.length > 0);
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
            maxHeight: '320px',
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
