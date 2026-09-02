'use client';

import React, { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { perfMark, perfMeasure } from '@/lib/perf-debug';

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
  matchNote?: string | null;
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
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  // SEARCH_MAP_PERFORMANCE_V2_2 §9 — 요청이 100~200ms 넘게 걸리면 "검색 중..." 표시.
  // 너무 짧게(즉시) 켜면 캐시 히트/빠른 응답에서도 깜빡여 오히려 산만하므로, 150ms
  // 지연 타이머로 감싸 이미 응답이 온 빠른 케이스에서는 아예 보이지 않게 한다.
  const [isSearching, setIsSearching] = useState(false);
  
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
    if (showDropdown || isSearching) {
      updateRect();
      window.addEventListener('scroll', updateRect, true);
      window.addEventListener('resize', updateRect);
      return () => {
        window.removeEventListener('scroll', updateRect, true);
        window.removeEventListener('resize', updateRect);
      };
    }
  }, [showDropdown, isSearching]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const cacheRef = useRef<Map<string, any[]>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      return;
    }
    // §5/§24 T0 — 사용자가 마지막 문자를 입력한 시점(이 effect가 매 keystroke마다 새로
    // 실행되므로, 실제로 반영되는 건 debounce 타이머가 끝까지 살아남는 마지막 호출뿐이다).
    perfMark('search:t0-input');

    const trimmed = keyword.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setShowDropdown(false);
      setIsSearching(false);
      onQueryStateChange?.({ keyword: '', hasResults: false });
      return;
    }

    if (cacheRef.current.has(trimmed)) {
      const cached = cacheRef.current.get(trimmed)!;
      setResults(cached);
      setShowDropdown(cached.length > 0);
      setIsSearching(false);
      onQueryStateChange?.({ keyword, hasResults: cached.length > 0 });
      return;
    }

    const timer = setTimeout(async () => {
      perfMark('search:t2-request-start');
      perfMeasure('search: input→request', 'search:t0-input', 'search:t2-request-start');
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      // 150ms 넘게 걸리는 요청만 "검색 중..."을 보여준다(§9) — abort/완료 시 반드시 clear.
      const loadingTimer = setTimeout(() => {
        if (!abortController.signal.aborted) setIsSearching(true);
      }, 150);

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: abortController.signal });
        if (!res.ok) throw new Error('Network error');
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
        
        if (abortController.signal.aborted) return;
        
        cacheRef.current.set(trimmed, combined);
        setResults(combined);
        setShowDropdown(combined.length > 0);
        onQueryStateChange?.({ keyword, hasResults: combined.length > 0 });
        perfMeasure('search: request 왕복', 'search:t2-request-start');
        perfMeasure('search: input→first result(커밋 직전)', 'search:t0-input');
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error('Search failed', err);
        setResults([]);
        setShowDropdown(false);
        onQueryStateChange?.({ keyword, hasResults: false });
      } finally {
        clearTimeout(loadingTimer);
        if (!abortController.signal.aborted) setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [keyword]);

  // PERCEIVED_PERFORMANCE_V1 §5/§6 — 사용자가 실제로 hover/touch한 결과 하나만
  // 라우트 shell을 미리 준비한다(전체 결과 무차별 prefetch 아님). 이 컴포넌트는
  // 이름만 알고 identity 검증은 하지 않으므로, 검증 전 데이터를 미리 보여주는 것이
  // 아니라 `/apt/[name]` 페이지의 JS 청크만 미리 받아두는 것 — 실제 단지 데이터는
  // 여전히 실제 이동(및 각 호출부의 검증 로직) 이후에만 불러온다. 잘못 눌러도
  // 부작용 없음(prefetch는 네비게이션을 일으키지 않음).
  const handleHoverPrefetch = (item: any) => {
    if (item.type !== 'APARTMENT') return;
    router.prefetch(`/apt/${encodeURIComponent(item.name)}`);
  };

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

    return (
      <>
        {parts.length > 0 && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{parts.join(' · ')}</div>
        )}
        {item.matchNote && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>지도상 명칭: {item.matchNote}</div>
        )}
      </>
    );
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
      {!showDropdown && isSearching && dropdownRect && (
        <div
          style={{
            position: 'fixed',
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
            background: 'white',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
            padding: '0.6rem 0.9rem',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            zIndex: 99999,
          }}
        >
          검색 중...
        </div>
      )}
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
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#f8fafc';
                handleHoverPrefetch(item);
              }}
              onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
              onTouchStart={() => handleHoverPrefetch(item)}
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
