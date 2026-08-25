'use client';

import React, { useRef, useState, useEffect } from 'react';

export type SearchResultType = 'REGION' | 'APARTMENT';

export interface ApartmentSearchResult {
  type: SearchResultType;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  sido?: string;
  sigungu?: string;
  dong?: string;
  lawdCd?: string;
  apartmentId?: number;
  aptSeq?: string | null;
  totalHouseholds?: number | null;
  completionYear?: number | null;
}

interface ApartmentAutocompleteProps {
  onSelect: (result: ApartmentSearchResult) => void;
  placeholder?: string;
  categoryFilter?: string | null;
  onSubmit?: (keyword: string) => void;
  autoFocus?: boolean;
  inputStyle?: React.CSSProperties;
  onQueryStateChange?: (state: { keyword: string; hasResults: boolean }) => void;
  biasLocation?: { lat: number; lng: number };
}

const SCRIPT_ID = 'kakao-map-script-main';

export default function ApartmentAutocomplete({
  onSelect,
  placeholder,
  categoryFilter = '아파트',
  onSubmit,
  autoFocus = false,
  inputStyle,
  onQueryStateChange,
  biasLocation,
}: ApartmentAutocompleteProps) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressNextSearchRef = useRef(false);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const updateRect = () => {
      if (inputRef.current) {
        const rect = inputRef.current.getBoundingClientRect();
        setDropdownRect({
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
        });
      }
    };
    if (showDropdown) {
      updateRect();
      window.addEventListener('scroll', updateRect, true);
      window.addEventListener('resize', updateRect);
      return () => {
        window.removeEventListener('scroll', updateRect, true);
        window.removeEventListener('resize', updateRect);
      };
    }
  }, [showDropdown]);

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
    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      return;
    }

    if (!keyword.trim() || keyword.trim().length < 2) {
      setResults([]);
      setShowDropdown(false);
      onQueryStateChange?.({ keyword: '', hasResults: false });
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(keyword)}`);
        const data = await res.json();
        
        // Ensure we load Kakao SDK for geocoding regions on click
        if (!window.kakao?.maps) {
          const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
          if (apiKey && !document.getElementById(SCRIPT_ID)) {
            const script = document.createElement('script');
            script.id = SCRIPT_ID;
            script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer&autoload=false`;
            document.head.appendChild(script);
            script.addEventListener('load', () => window.kakao.maps.load(() => {}));
          }
        }

        let combined: any[] = [];
        
        // If categoryFilter is null, it means we show regions too (like RegionSelectModal)
        // Actually, we should always show regions and apartments, but let's put regions first
        if (data.regions && data.regions.length > 0) {
          combined = [...combined, ...data.regions];
        }
        if (data.apartments && data.apartments.length > 0) {
          combined = [...combined, ...data.apartments];
        }
        
        setResults(combined);
        setShowDropdown(combined.length > 0);
        onQueryStateChange?.({ keyword, hasResults: combined.length > 0 });
      } catch (err) {
        console.error('Search failed', err);
        setResults([]);
        setShowDropdown(false);
        onQueryStateChange?.({ keyword, hasResults: false });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [keyword]);

  const handleSelect = async (item: any) => {
    setShowDropdown(false);
    suppressNextSearchRef.current = true;
    setKeyword(item.name);
    
    let lat = item.lat || 0;
    let lng = item.lng || 0;

    if (item.type === 'REGION') {
      if (window.kakao?.maps?.services) {
        const geocoder = new window.kakao.maps.services.Geocoder();
        const address = `${item.sido} ${item.sigungu} ${item.dong}`;
        await new Promise<void>((resolve) => {
          geocoder.addressSearch(address, (result: any, status: any) => {
            if (status === window.kakao.maps.services.Status.OK) {
              lat = parseFloat(result[0].y);
              lng = parseFloat(result[0].x);
            }
            resolve();
          });
        });
      }
    }

    onSelect({
      type: item.type,
      name: item.name,
      address: item.type === 'REGION' ? `${item.sido} ${item.sigungu} ${item.dong}` : (item.jibun || item.dong || ''),
      lat,
      lng,
      sido: item.sido,
      sigungu: item.sigungu,
      dong: item.dong,
      lawdCd: item.lawdCd,
      apartmentId: item.apartmentId,
      aptSeq: item.aptSeq,
      totalHouseholds: item.totalHouseholds,
      completionYear: item.completionYear,
    });
  };

  const renderEnrichmentLine = (item: any) => {
    if (item.type === 'REGION') return null;
    
    const parts = [
      item.totalHouseholds ? `${item.totalHouseholds}세대` : null,
      item.completionYear ? `${item.completionYear}년 준공` : null,
    ].filter(Boolean);
    
    if (parts.length === 0) return null;
    return <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{parts.join(' · ')}</div>;
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        autoFocus={autoFocus}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) {
            setShowDropdown(false);
            onSubmit(keyword);
          }
        }}
        placeholder={placeholder || '아파트명 검색'}
        style={{
          width: '100%',
          padding: '0.6rem 1rem',
          border: '1px solid var(--border-color)',
          borderRadius: '99px',
          outline: 'none',
          fontSize: '1rem',
          boxSizing: 'border-box',
          ...inputStyle,
        }}
      />
      {showDropdown && dropdownRect && (
        <ul
          style={{
            position: 'fixed',
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
            background: 'white',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
            listStyle: 'none',
            margin: 0,
            padding: '0.4rem',
            maxHeight: '360px',
            overflowY: 'auto',
            zIndex: 99999,
          }}
        >
          {results.map((item, i) => (
            <li
              key={`${item.type}-${item.name}-${i}`}
              onClick={() => handleSelect(item)}
              style={{
                padding: '0.6rem 0.75rem',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = '#f8fafc')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: item.type === 'REGION' ? '#2563eb' : 'var(--text-primary)' }}>
                {item.type === 'REGION' ? `📍 지역: ${item.name}` : item.name}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {item.type === 'REGION' ? `${item.sido} ${item.sigungu} ${item.dong}` : (item.jibun ? `${item.dong} ${item.jibun}` : item.dong)}
              </div>
              {renderEnrichmentLine(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
