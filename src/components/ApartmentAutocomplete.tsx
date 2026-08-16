'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';

export interface ApartmentSearchResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface ApartmentAutocompleteProps {
  onSelect: (result: ApartmentSearchResult) => void;
  placeholder?: string;
  /** 검색 결과를 이 문자열이 category_name에 포함된 것만 남긴다. null이면 필터링 없이
   * 카카오 키워드 검색 결과를 그대로 보여준다(동/지역명 등 아파트가 아닌 장소도 검색해야
   * 하는 화면에서 사용). 생략 시 기존 동작(아파트만)을 그대로 유지한다. */
  categoryFilter?: string | null;
  /** 드롭다운에서 항목을 고르지 않고 Enter를 눌렀을 때(예: 정확한 지역명을 바로 검색) 호출된다. */
  onSubmit?: (keyword: string) => void;
  autoFocus?: boolean;
  inputStyle?: React.CSSProperties;
  // [UI-C1] 부모가 현재 검색어/결과 유무를 알아야 할 때만 선택적으로 구독한다(예: 검색어가
  // 비어 있으면 "최근 본 단지"를, 결과가 0건이면 안내 문구를 보여주는 화면). 기존
  // 호출부(지도/통계/지역선택)는 이 prop을 넘기지 않으므로 동작이 전혀 바뀌지 않는다.
  onQueryStateChange?: (state: { keyword: string; hasResults: boolean }) => void;
  // [UI-C1-FIX] 카카오 키워드 검색은 기본적으로 전국 범위라, 동명 단지가 전혀 다른
  // 지역에서 1순위로 잡히는 오매칭 위험이 있다(실측: "금호어울림" 검색 시 경기 남양주
  // 단지가 1순위). 이 좌표를 넘기면 그 위치에 가까운 결과가 우선 정렬된다(하드
  // 반경 제한은 아님 — 전국 결과 자체는 그대로 나오되 순서만 바뀐다). 기존
  // 호출부(지도/통계/지역선택)는 넘기지 않으므로 기존 정렬(정확도순) 그대로 유지된다.
  biasLocation?: { lat: number; lng: number };
}

const DEFAULT_CATEGORY_FILTER = '아파트';

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

interface DropdownRect {
  top: number;
  left: number;
  width: number;
}

// 카카오 장소 키워드 검색(SearchFilterBar.tsx와 같은 방식)으로 아파트 단지를 찾는 자동완성.
// 카카오 로컬 API 자체는 세대수/준공연월/건물유형을 제공하지 않는다 — 그 값이 필요하면
// 이 앱이 이미 갖고 있는 실제 데이터 소스(/api/apt/[name]/info, 단지 상세페이지가 쓰는 것과
// 동일한 라우트)를 상위 결과에 한해 추가로 조회해서 채운다. 값을 지어내지 않는다.
export default function ApartmentAutocomplete({
  onSelect,
  placeholder,
  categoryFilter = DEFAULT_CATEGORY_FILTER,
  onSubmit,
  autoFocus,
  inputStyle,
  onQueryStateChange,
  biasLocation,
}: ApartmentAutocompleteProps) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [enrichment, setEnrichment] = useState<Record<string, Enrichment | 'loading' | null>>({});
  const [dropdownRect, setDropdownRect] = useState<DropdownRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // handleSelect가 입력값을 단지명으로 채우는데, 그게 keyword state를 바꿔서 검색
  // useEffect를 다시 돌리면 방금 닫은 드롭다운이 검색 결과와 함께 곧바로 재오픈되는
  // 버그가 있었다 — 선택 직후 한 번의 자동 재검색만 건너뛰도록 플래그로 막는다.
  const suppressNextSearchRef = useRef(false);

  // 드롭다운을 position:absolute(부모 기준 상대좌표)가 아니라 position:fixed + 뷰포트
  // 절대좌표로 그린다. /map 페이지에서 이 컴포넌트는 이미 position:absolute인 검색창
  // 래퍼 안에 중첩돼 있는데, absolute 자식은 그 조상의 스태킹 컨텍스트에 갇혀서 카카오맵
  // SDK가 내부적으로 쓰는 z-index와 우선순위 다툼에서 밀릴 수 있다(특히 모바일에서
  // 가상키보드가 뜨며 레이아웃이 재계산될 때 위치가 어긋나거나 지도 레이어 뒤로 묻히는
  // 현상의 원인). fixed + getBoundingClientRect로 매번 입력창 바로 아래 절대좌표를
  // 계산해서 그리면 조상의 스태킹 컨텍스트를 완전히 벗어나므로 이 문제가 구조적으로
  // 사라진다.
  const updateDropdownRect = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownRect({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!showDropdown) return;
    updateDropdownRect();

    // 모바일 가상 키보드가 열리고 닫힐 때 visualViewport의 resize/scroll 이벤트가 발생한다
    // (레이아웃 뷰포트 크기 자체는 안 바뀌는 브라우저가 많아 window resize만으로는 못 잡는다).
    const vv = window.visualViewport;
    window.addEventListener('resize', updateDropdownRect);
    window.addEventListener('scroll', updateDropdownRect, true);
    vv?.addEventListener('resize', updateDropdownRect);
    vv?.addEventListener('scroll', updateDropdownRect);

    return () => {
      window.removeEventListener('resize', updateDropdownRect);
      window.removeEventListener('scroll', updateDropdownRect, true);
      vv?.removeEventListener('resize', updateDropdownRect);
      vv?.removeEventListener('scroll', updateDropdownRect);
    };
  }, [showDropdown, updateDropdownRect]);

  useEffect(() => {
    // 드롭다운은 position:fixed로 시각적 위치만 옮겨질 뿐 DOM상으로는 여전히
    // containerRef의 자식이라, contains() 검사 하나로 입력창+드롭다운 클릭을 모두 잡는다.
    const handleClickOutside = (e: Event) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    // 모바일 터치 환경에서도 확실히 닫히도록 mousedown과 touchstart 둘 다 건다.
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  const enrichTopResults = (apartments: any[]) => {
    if (!window.kakao?.maps?.services) return;
    const geocoder = new window.kakao.maps.services.Geocoder();

    apartments.slice(0, ENRICH_COUNT).forEach((place) => {
      // /api/apt/[name]/info는 아파트 단지 전용 데이터라, categoryFilter를 끈 화면(동/지역명
      // 검색)에서 아파트가 아닌 장소가 섞여 들어와도 그런 항목은 조회하지 않는다.
      if (!place.category_name || !place.category_name.includes(DEFAULT_CATEGORY_FILTER)) return;
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
    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      return;
    }

    if (!keyword.trim()) {
      setResults([]);
      setShowDropdown(false);
      onQueryStateChange?.({ keyword: '', hasResults: false });
      return;
    }

    const timer = setTimeout(() => {
      const runSearch = () => {
        if (!window.kakao?.maps?.services) return;
        const ps = new window.kakao.maps.services.Places();
        // biasLocation이 있으면(예: 현재 보고 있는 단지 좌표) 카카오 검색에 위치를
        // 함께 넘겨 관련성 순위 안에서 그 위치와 가까운 결과가 더 우선되도록 한다.
        // sort를 DISTANCE로 강제하지는 않는다 — 실측 결과 DISTANCE 강제 정렬은 정확한
        // 이름으로 검색해도 더 가까운 무관한 장소에 밀려 정답이 검색 결과 자체에서
        // 빠져버리는 회귀를 만들었다(예: "동래래미안아이파크"가 상위 10건 밖으로
        // 밀림). location만 넘기고 기본 정확도 정렬을 유지하면 이 회귀 없이도
        // 동명 단지가 다른 지역에서 1순위로 잡히는 빈도를 줄이는 효과가 있었다(실측).
        const searchOptions = biasLocation
          ? { location: new window.kakao.maps.LatLng(biasLocation.lat, biasLocation.lng) }
          : undefined;
        ps.keywordSearch(keyword, (data: any, status: any) => {
          if (status === window.kakao.maps.services.Status.OK) {
            // categoryFilter가 있으면 그 카테고리만 남긴다(예: '아파트'로 단지 검색 시 역/상점
            // 등 노이즈 제거). null이면 동/지역명 검색을 위해 필터링하지 않는다.
            const apartments = categoryFilter
              ? data.filter((p: any) => p.category_name && p.category_name.includes(categoryFilter))
              : data;
            setEnrichment({});
            setResults(apartments);
            setShowDropdown(apartments.length > 0);
            enrichTopResults(apartments);
            onQueryStateChange?.({ keyword, hasResults: apartments.length > 0 });
          } else {
            setResults([]);
            setShowDropdown(false);
            onQueryStateChange?.({ keyword, hasResults: false });
          }
        }, searchOptions);
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
    suppressNextSearchRef.current = true;
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
      // info['사용승인일']는 이미 "YYYY년" 형식으로 저장돼 있어(route.ts 확인) 뒤에
      // "년"을 또 붙이면 "2020년년"처럼 중복된다.
      e.buildYear ? `${e.buildYear.includes('년') ? e.buildYear : `${e.buildYear}년`} 준공` : null,
      e.buildingType,
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
        placeholder={placeholder || '아파트 단지명 검색'}
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
            // 카카오맵 SDK 내부 레이어(타일/오버레이/컨트롤)가 흔히 쓰는 값보다 확실히
            // 높게 잡아서 모바일에서도 절대 지도 뒤로 묻히지 않게 한다.
            zIndex: 99999,
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
