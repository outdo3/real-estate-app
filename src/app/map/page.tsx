'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Map as KakaoMap, CustomOverlayMap } from 'react-kakao-maps-sdk';
import ApartmentAutocomplete, { ApartmentSearchResult } from '@/components/ApartmentAutocomplete';
import { perfMark, perfMeasure } from '@/lib/perf-debug';
// AptMarker/AptCluster 타입과 selected-marker fast-path 판정 로직은
// src/lib/map-selected-marker.ts로 분리해 부작용 없이 단위 테스트한다(§26).
import type { AptMarker, AptCluster } from '@/lib/map-selected-marker';
import { buildPendingSelectedApt, resolveSelectedMarker, isPendingStillNeeded } from '@/lib/map-selected-marker';
import FullPageLoader from '@/components/FullPageLoader';
import AdContainer from '@/components/AdContainer';
import BottomNav from '@/components/ui/BottomNav';

// [DESIGN SYSTEM 3 §9] 지도 페이지는 전체화면 커스텀 UI라 Header를 아예
// 렌더링하지 않으므로(상단 로고바가 지도를 가리는 걸 막기 위함) 하단탭바만
// 공용 BottomNav 컴포넌트로 별도 렌더링한다 — 기존에는 이 페이지가 동일한
// 마크업/스타일을 인라인으로 직접 그렸는데, Header.tsx의 모바일 버전과
// 로직이 갈라질 위험이 있어 공용 컴포넌트로 대체했다(시각적 변경 없음).

const apiKey =
  process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY ||
  process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;


// 화면 픽셀 기준 이 거리 안에 있는 칩들은 한 그룹으로 묶는다. 서구 원도심처럼 오래된
// 소규모 단지가 밀집한 지역에서는 칩이 서로 완전히 겹쳐 뒤에 깔린 단지가 실제로는
// 존재해도 "마커가 안 보인다"는 문제로 이어졌었다 — 데이터가 없어서가 아니라 화면에서
// 물리적으로 가려진 것. 숫자 배지로 뭉치는 대신, 그룹 안 칩들을 정사각형에 가까운
// 격자로 살짝 벌려서 각자 정보가 그대로 보이게 한다(뱃지 방식은 정보가 안 보인다는
// 피드백을 받아 교체함). 확대 단계별로 칩 크기 자체가 다르므로(아래 CHIP_LAYOUT),
// 클러스터링 반경/격자 간격도 현재 확대 단계에 맞는 값을 써야 실제 렌더 크기와
// 어긋나지 않는다.
const DETAIL_ZOOM_LEVEL = 4; // 카카오맵 레벨(숫자가 작을수록 확대) 기준: 이 값 이하로 확대해야 단지명+실거래가 상세 카드로 전환됨
const CHIP_LAYOUT = {
  compact: { width: 60, height: 26, gap: 4, clusterRadius: 38 },
  detailed: { width: 92, height: 42, gap: 6, clusterRadius: 52 },
};

interface SchoolMarker {
  id: string;
  name: string;
  level: '초' | '중' | '고';
  lat: number;
  lng: number;
}

// 요청된 6개 카테고리. apt/school은 실제 데이터(MOLIT 실거래/카카오 학교 POI)로 필터링
// 동작하고, officetel/livingLodging/redevelopment/auction은 이 앱에 아직 연동된 데이터
// 소스가 없어(오피스텔·생활숙박시설 실거래는 MOLIT API 자체가 아파트와 별도 엔드포인트라
// 미연동, 재개발/경공매도 기존과 동일) 지어낸 마커 대신 정직하게 "준비 중" 안내만 띄운다.
type LayerKey = 'apt' | 'officetel' | 'livingLodging' | 'redevelopment' | 'auction' | 'school';

const LEVEL_COLOR: Record<SchoolMarker['level'], string> = {
  초: '#3b82f6',
  중: '#10b981',
  고: '#f59e0b',
};

const classifySchoolLevel = (name: string): SchoolMarker['level'] | null => {
  if (name.includes('초등학교')) return '초';
  if (name.includes('고등학교')) return '고'; // '중'보다 먼저 검사(고등학교엔 '중'이 안 들어가므로 순서 무관하지만 명확성 위해 고→중→초 순으로 방어적으로 배치)
  if (name.includes('중학교')) return '중';
  return null;
};

export default function FullscreenMapPage() {
  const router = useRouter();

  const [aptMarkers, setAptMarkers] = useState<AptMarker[]>([]);
  const [aptClusters, setAptClusters] = useState<AptCluster[]>([]);
  const [schoolMarkers, setSchoolMarkers] = useState<SchoolMarker[]>([]);
  // 초기 진입 시 마커가 너무 빽빽하게 겹쳐 보이는 문제(레벨 6은 화면 안에 너무 넓은
  // 지역이 들어와 단지 밀집 지역에서 칩이 서로 겹침) — 레벨 4로 1~2단계 더 확대해
  // 시작하면 DETAIL_ZOOM_LEVEL(4) 기준 상세 카드 모드로 시작해 칩 간격이 넉넉해진다.
  const [zoomLevel, setZoomLevel] = useState(4);
  // [MAP-FIX] 이전에는 hover와 click이 같은 selectedMarkerId 하나를 공유해서, PC에서
  // 마커에 마우스를 올리면 바텀시트가 뜨지만 마우스를 마커 밖(바텀시트 쪽)으로 옮기는
  // 순간 onMouseLeave가 곧바로 selectedMarkerId를 지워버려 "상세보기"를 누르기 전에
  // 시트가 사라지는 버그가 있었다. hover(선점, 마우스가 떠나면 사라짐)와 click(고정,
  // 다른 곳을 클릭하기 전까지 유지)을 별도 state로 분리해 해결한다.
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
  // SEARCH_MAP_PERFORMANCE_V2_2 §13/§14 — SELECTED MARKER FIRST. 검색 결과 클릭 시점에
  // 이미 aptSeq/좌표/이름을 갖고 있으므로, 실거래 기반 aptMarkers 전체(느린 /api/transactions
  // months=12 + 단지별 Kakao 지오코딩 N회)가 도착할 때까지 기다리지 않고 이 임시 마커를
  // 즉시 보여준다. aptSeq가 있을 때만 만든다(name-only identity 금지, 다른 단지 fallback
  // 금지) — 실제 aptClusters에 같은 id의 진짜 마커가 도착하면 selectedMarker/렌더 둘 다
  // 자동으로 진짜 데이터를 우선해 교체한다(중복 없는 reconcile, 아래 참고).
  const [pendingSelectedApt, setPendingSelectedApt] = useState<AptMarker | null>(null);
  // 클릭으로 고정된 마커가 있으면 그것을 우선하고, 없을 때만 hover 중인 마커를 보여준다 —
  // 고정된 마커가 있는 동안에는 다른 마커를 hover해도 바텀시트가 바뀌지 않는다(§5 우선순위).
  const activeMarkerId = selectedMarkerId ?? hoveredMarkerId;
  // 바텀시트에 표시할 마커의 전체 정보 — 조기 return(로딩/에러 화면)보다 위에서
  // 계산해야 훅 호출 순서가 렌더마다 always 동일하게 유지된다(Rules of Hooks).
  const selectedMarker = useMemo(
    () => resolveSelectedMarker(activeMarkerId, aptClusters, pendingSelectedApt),
    [activeMarkerId, aptClusters, pendingSelectedApt]
  );

  // 진짜 마커 데이터가 도착해 같은 id를 이미 포함하면 임시 마커는 더 이상 필요 없다 —
  // 화면 렌더는 이미 resolveSelectedMarker 쪽을 우선하지만(위), pending 상태 자체도
  // 정리해 다음 선택 사이클에 이전 세션의 값이 남아있지 않게 한다.
  useEffect(() => {
    if (isPendingStillNeeded(aptClusters, pendingSelectedApt)) return;
    if (pendingSelectedApt) setPendingSelectedApt(null);
  }, [aptClusters, pendingSelectedApt]);
  // 현재 화면의 마커들을 조회할 때 실제로 사용한 lawdCd. 마커 클릭 시 상세페이지로 이 값을
  // 함께 넘겨야 한다 — 안 넘기면 상세페이지가 자기 자신의 하드코딩된 기본 지역(서울 강남구)으로
  // 실거래가를 조회해 엉뚱한 지역/빈 데이터가 뜨는 버그로 이어진다.
  const [currentLawdCd, setCurrentLawdCd] = useState('26140');
  const isDetailed = zoomLevel <= DETAIL_ZOOM_LEVEL;
  const chipLayout = isDetailed ? CHIP_LAYOUT.detailed : CHIP_LAYOUT.compact;
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapInstanceReady, setMapInstanceReady] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [center, setCenter] = useState({ lat: 35.0979, lng: 129.0244 }); // 기본: 부산광역시 서구
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    apt: true,
    officetel: false,
    livingLodging: false,
    redevelopment: false,
    auction: false,
    school: false,
  });
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!apiKey) return;

    const scriptId = 'kakao-map-script-main';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer&autoload=false`;
      script.async = true;
      document.head.appendChild(script);
    }

    // 광고차단 확장 프로그램이나 특정 통신사/사내망이 dapi.kakao.com 스크립트 자체를
    // 막는 경우가 실제로 있다 — 이전에는 그러면 아래 폴링이 영원히 실패 상태로 남아
    // 사용자에게 아무 신호 없이 "지도 데이터를 불러오는 중입니다..."에서 페이지가
    // 멈춘 것처럼 보였다. 스크립트 자체의 로드 실패를 즉시 감지하고, 혹시 그 신호를
    // 놓치는 경우를 대비해 폴링에도 타임아웃을 둬서 반드시 사용자에게 원인을 알린다.
    const handleScriptError = () => {
      setMapLoadError('카카오맵 스크립트를 불러오지 못했습니다. 광고 차단 확장 프로그램이나 네트워크(사내망/통신사) 설정이 dapi.kakao.com 접속을 막고 있을 수 있습니다.');
    };
    script.addEventListener('error', handleScriptError);

    const checkKakao = setInterval(() => {
      if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
        clearInterval(checkKakao);
        setIsMapReady(true);
      } else if (window.kakao && window.kakao.maps) {
        // In case load wasn't called by page.tsx
        clearInterval(checkKakao);
        window.kakao.maps.load(() => {
          setIsMapReady(true);
        });
      }
    }, 200);

    const timeout = setTimeout(() => {
      clearInterval(checkKakao);
      setIsMapReady((ready) => {
        if (!ready) {
          setMapLoadError('지도를 불러오는 데 시간이 너무 오래 걸립니다. 네트워크 상태를 확인하거나 광고 차단 확장 프로그램을 꺼보세요.');
        }
        return ready;
      });
    }, 10000);

    return () => {
      clearInterval(checkKakao);
      clearTimeout(timeout);
      script?.removeEventListener('error', handleScriptError);
    };
  }, [apiKey]);

  // 단지(아파트) 마커: 좌표만으로는 어느 시군구(lawdCd) 실거래 데이터를 조회해야 할지 알 수
  // 없으므로, 우선 좌표를 lawdCd로 역지오코딩한 다음 그 지역의 실거래를 넓은 기간(12개월)으로
  // 조회한다. 이전에는 이 페이지가 /api/transactions를 파라미터 없이 호출해서(= lawdCd 없음)
  // 서버가 항상 빈 배열을 반환했다 — 그래서 지도에 마커가 하나도 안 뜨던 게 근본 원인이었다.
  // "최근 3개월 내 거래 없는 단지는 마커가 아예 안 뜨는" 문제도 여기서 같이 해결된다: 최근
  // 3개월치만 보던 홈 화면과 달리 지도 마커는 12개월 윈도우 안에서 가장 최근 거래를 찾아
  // "기존 가격"으로라도 보여준다. 다만 12개월 안에도 거래가 전혀 없는 단지는 이 데이터
  // 소스(MOLIT 실거래) 자체에 존재 근거가 없어 마커를 만들 수 없다 — 그 경우까지 100%
  // 커버하려면 별도의 "단지 마스터 목록" 데이터가 필요한데 이 앱엔 아직 없다.
  // SEARCH_MAP_PERFORMANCE_V2_2 §16 — knownLawdCd가 있으면(검색 결과가 이미 lawdCd를
  // 갖고 있는 경우) 이 지역을 알아내기 위한 Kakao 역지오코딩 왕복 호출을 통째로
  // 건너뛴다. 드래그/현재위치 등 좌표만 아는 기존 호출부는 knownLawdCd를 안 넘기므로
  // 이전과 동일하게 역지오코딩을 사용한다(회귀 없음).
  const fetchAptMarkers = async (lat: number, lng: number, knownLawdCd?: string) => {
    const loadForLawdCd = async (lawdCd: string) => {
      setCurrentLawdCd(lawdCd);
      try {
        // 실거래 마커 데이터와 "최근 24시간 내 커뮤니티 글이 있는 단지" 집계는 서로
        // 무관한 조회라 Promise.all로 병렬 처리한다.
        const [res, activityRes] = await Promise.all([
          fetch(`/api/transactions?type=apt&lawdCd=${lawdCd}&months=12`),
          fetch(`/api/community/recent-activity`).catch(() => null),
        ]);
        const data = await res.json();
        if (!Array.isArray(data)) return;

        let recentActivity: Record<string, number> = {};
        if (activityRes && activityRes.ok) {
          const activityJson = await activityRes.json();
          if (activityJson.success) recentActivity = activityJson.data || {};
        }

        // 단지별(name+dong) 최신 거래 1건만 남긴다 — 같은 단지의 여러 거래가 마커로
        // 중복 표시되는 것을 막는다. data는 이미 route.ts에서 계약일 최신순 정렬됨.
        const byComplex = new Map<string, any>();
        for (const item of data) {
          if (!item.lat || !item.lng) continue;
          const key = `${item.dong}|${item.name}`;
          if (!byComplex.has(key)) byComplex.set(key, item);
        }

        const markers: AptMarker[] = Array.from(byComplex.values()).map((item: any) => ({
          id: item.aptSeq || `${item.dong}-${item.name}`,
          aptSeq: item.aptSeq,
          completionYear: item.completionYear,
          name: item.name,
          dong: item.dong || '',
          price: item.price || '시세 정보 없음',
          hasRecentPrice: !!item.price,
          lat: item.lat,
          lng: item.lng,
          hasNewPost: (recentActivity[item.name] || 0) > 0,
        }));

        setAptMarkers(markers);
        // §12 M6 — 주변 마커 전체 dataset 준비 완료(M0 클릭 흐름에서 호출된 경우에만
        // 의미 있음 — 드래그/현재위치 등 다른 호출부에서도 공유되는 mark라 클릭 흐름이
        // 아닐 때는 이 measure가 실패해도(시작 mark 없음) 무해하게 무시된다).
        perfMeasure('map: click→surrounding markers ready', 'map:m0-click');
      } catch (error) {
        console.error('Failed to fetch apt markers:', error);
      } finally {
        setIsLoadingData(false);
      }
    };

    if (knownLawdCd) {
      await loadForLawdCd(knownLawdCd);
      return;
    }

    if (!window.kakao?.maps?.services) {
      setIsLoadingData(false);
      return;
    }
    const geocoder = new window.kakao.maps.services.Geocoder();

    geocoder.coord2RegionCode(lng, lat, (result: any, status: any) => {
      // 사용자의 실제 GPS 좌표가 국내 행정구역으로 역지오코딩되지 않는 경우(해외, 또는
      // 카카오가 지원하지 않는 좌표)가 실제로 있다 — 이때 그냥 return해버리면
      // isLoadingData가 영원히 true로 남아 페이지 전체가 "지도 데이터를 불러오는
      // 중입니다..."에 멈춘 것처럼 보이는 심각한 버그였다(발견: 실사용자 리포트로 좌표
      // 실패 케이스를 재현). 역지오코딩이 실패하면 이 서비스의 기본 대상 지역(부산 서구)
      // 데이터로 폴백해서 최소한 화면에 뭔가는 뜨게 한다.
      const DEFAULT_FALLBACK_LAWD_CD = '26140'; // 부산광역시 서구
      const region = status === window.kakao.maps.services.Status.OK
        ? result.find((r: any) => r.region_type === 'B')
        : null;
      const lawdCd = region ? region.code.substring(0, 5) : DEFAULT_FALLBACK_LAWD_CD;
      loadForLawdCd(lawdCd);
    });
  };

  // 학교 레이어: 나이스(NEIS) 학년별 통계는 이 앱에 실제 데이터가 없어(코드 확인 결과 해시
  // 기반 시뮬레이션) 새로 노출하지 않는다. 대신 카카오 실제 장소검색(SC4=학교 카테고리)
  // 결과를 그대로 쓰고, 실제 학교명 문자열에서 "초등학교/중학교/고등학교"를 그대로 읽어
  // 초/중/고 배지로 분류한다 — 지어낸 값이 아니라 실제 이름을 파싱만 한 것이다.
  const fetchSchoolMarkers = (lat: number, lng: number) => {
    if (!window.kakao?.maps?.services) return;
    const ps = new window.kakao.maps.services.Places();
    const coords = new window.kakao.maps.LatLng(lat, lng);

    ps.categorySearch(
      'SC4',
      (result: any, status: any) => {
        if (status !== window.kakao.maps.services.Status.OK) return;
        const markers: SchoolMarker[] = result
          .map((p: any) => {
            const level = classifySchoolLevel(p.place_name);
            if (!level) return null;
            return {
              id: p.id,
              name: p.place_name,
              level,
              lat: parseFloat(p.y),
              lng: parseFloat(p.x),
            } as SchoolMarker;
          })
          .filter(Boolean);
        setSchoolMarkers(markers);
      },
      { location: coords, radius: 3000, sort: window.kakao.maps.services.SortBy.DISTANCE }
    );
  };

  const refreshActiveLayers = (lat: number, lng: number, knownLawdCd?: string) => {
    if (layers.apt) fetchAptMarkers(lat, lng, knownLawdCd);
    if (layers.school) fetchSchoolMarkers(lat, lng);
  };

  // aptMarkers를 현재 지도 줌/중심 기준 화면 픽셀 좌표로 투영해서 서로 가까운 칩끼리
  // 묶는다. 실제 kakao.maps.Map 인스턴스의 projection API가 필요해서(react-kakao-maps-sdk
  // 프롭이 아니라 원본 SDK 기능) mapRef를 직접 사용한다.
  const recomputeClusters = () => {
    const map = mapRef.current;
    if (!map || !window.kakao?.maps || aptMarkers.length === 0) {
      setAptClusters([]);
      return;
    }
    const projection = map.getProjection();
    if (!projection) return;

    const points = aptMarkers.map((m) => {
      const p = projection.containerPointFromCoords(new window.kakao.maps.LatLng(m.lat, m.lng));
      return { marker: m, x: p.x, y: p.y };
    });

    const used = new Array(points.length).fill(false);
    const result: AptCluster[] = [];

    points.forEach((p, i) => {
      if (used[i]) return;
      const group = [p];
      used[i] = true;
      points.forEach((q, j) => {
        if (used[j] || i === j) return;
        if (Math.hypot(p.x - q.x, p.y - q.y) <= chipLayout.clusterRadius) {
          group.push(q);
          used[j] = true;
        }
      });
      const avgLat = group.reduce((s, g) => s + g.marker.lat, 0) / group.length;
      const avgLng = group.reduce((s, g) => s + g.marker.lng, 0) / group.length;
      result.push({
        id: group.map((g) => g.marker.id).join(','),
        lat: avgLat,
        lng: avgLng,
        markers: group.map((g) => g.marker),
      });
    });

    setAptClusters(result);
  };

  // 최초 지도 준비 완료 + center 확정 시 최초 1회 로드
  useEffect(() => {
    if (!isMapReady) return;
    setIsLoadingData(true);
    refreshActiveLayers(center.lat, center.lng);
  }, [isMapReady]);

  // react-kakao-maps-sdk의 <Map ref={mapRef}>는 실제 kakao.maps.Map 인스턴스를 자기 내부
  // useEffect에서 비동기로 생성한 뒤에야 ref에 채워준다 — 그래서 "로딩 게이트를 지난 그
  // 커밋"에서 곧바로 mapRef.current를 참조하는 effect는 항상 null을 보고 조기 종료됐다
  // (ref 자체는 리액트 렌더 트리거가 아니라 effect 재실행도 안 됨 → 클러스터가 영원히
  // 빈 배열로 남아 마커가 하나도 안 그려지는 회귀로 이어졌다). SDK 로드 감지와 같은 이
  // 파일의 기존 관례(위 checkKakao setInterval)를 그대로 따라 짧은 폴링으로 실제 인스턴스
  // 생성을 기다린다.
  useEffect(() => {
    if (isLoadingData || !isMapReady) return;
    if (mapRef.current) {
      setMapInstanceReady(true);
      return;
    }
    const checkMapInstance = setInterval(() => {
      if (mapRef.current) {
        clearInterval(checkMapInstance);
        setMapInstanceReady(true);
      }
    }, 100);
    return () => clearInterval(checkMapInstance);
  }, [isLoadingData, isMapReady]);

  // 지도 인스턴스가 실제로 준비된 뒤 줌/드래그가 끝날 때마다(native 'idle' 이벤트) 클러스터를
  // 다시 계산한다. 데이터가 새로 들어와도(aptMarkers 변경) 같은 화면 상태 기준으로 즉시 한
  // 번 재계산한다. zoomLevel이 바뀌면(확대/축소로 칩 크기·클러스터 반경이 달라짐) 리스너를
  // 새 chipLayout을 참조하는 클로저로 다시 등록하고, 그 자리에서 즉시 한 번 재계산해
  // 'idle' 이벤트를 기다리지 않고도 칩 배치가 바로 갱신되게 한다.
  useEffect(() => {
    if (!mapInstanceReady || !mapRef.current || !window.kakao?.maps?.event) return;
    const map = mapRef.current;
    const handleIdle = () => recomputeClusters();
    window.kakao.maps.event.addListener(map, 'idle', handleIdle);
    recomputeClusters();
    return () => {
      window.kakao.maps.event.removeListener(map, 'idle', handleIdle);
    };
  }, [mapInstanceReady, aptMarkers, zoomLevel]);

  // 개별 마커 칩 하나를 그린다. 단독 마커든, 겹친 그룹을 격자로 벌린 것 중 하나든 이
  // 함수 하나로 렌더링해서 두 경우의 모양이 항상 같게 유지한다.
  // - isDetailed(확대 상태)가 아니면 단지명 없이 가격만 파스텔톤 알약 칩으로 간결하게 보여
  //   화면 점유율을 낮춘다. 확대해야만 단지명이 함께 보이는 상세 카드로 전환된다.
  // - 선택(터치/호버)된 마커는 강조 링 + 확대 transform으로 다른 마커보다 항상 눈에 띄게
  //   하고, 실제 겹침 순서는 호출부에서 CustomOverlayMap의 zIndex prop으로 9999를 줘서
  //   보장한다(CSS z-index만으로는 카카오 SDK가 각 오버레이를 별도 컨테이너로 그려서
  //   먹히지 않는다).
  const renderMarkerChip = (marker: AptMarker, selected: boolean) => {
    const currentYear = new Date().getFullYear();
    const isNewBuild = marker.completionYear ? (currentYear - marker.completionYear <= 5) : false;

    const accent = marker.hasRecentPrice ? 'var(--primary-color)' : '#94a3b8';
    
    // Selected style (highest priority): solid dark ring, larger scale
    // New build style: distinct background and a small badge
    const highlightRing = selected
      ? '0 0 0 3px #1e293b, 0 6px 14px rgba(0,0,0,0.22)'
      : '0 2px 5px rgba(0,0,0,0.12)';
      
    const chipBg = selected ? 'white' : (isNewBuild ? '#f0fdf4' : (marker.hasRecentPrice ? 'white' : '#f8fafc'));
    const chipBorder = selected ? '#1e293b' : (isNewBuild ? accent : (marker.hasRecentPrice ? accent : '#cbd5e1'));

    const handleHoverEnter = () => setHoveredMarkerId(marker.id);
    const handleHoverLeave = () => setHoveredMarkerId((cur) => (cur === marker.id ? null : cur));
    const handleClick = () => {
      if (selectedMarkerId === marker.id) {
        router.push(`/apt/${encodeURIComponent(marker.name)}?lawdCd=${currentLawdCd}&dong=${encodeURIComponent(marker.dong)}`);
      } else {
        setSelectedMarkerId(marker.id);
      }
    };

    const newPostBadge = marker.hasNewPost ? (
      <span
        style={{
          position: 'absolute',
          top: '-3px',
          right: '-3px',
          width: '10px',
          height: '10px',
          background: '#ef4444',
          borderRadius: '999px',
          boxShadow: '0 0 0 2px white',
          zIndex: 2,
        }}
      />
    ) : null;

    const newBuildBadge = isNewBuild ? (
      <span style={{
        position: 'absolute',
        top: '-8px',
        left: '-8px',
        background: 'var(--primary-color)',
        color: 'white',
        fontSize: '0.6rem',
        fontWeight: 800,
        padding: '1px 5px',
        borderRadius: '4px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
        zIndex: 2,
      }}>신축</span>
    ) : null;

    if (!isDetailed) {
      return (
        <div
          onClick={handleClick}
          onMouseEnter={handleHoverEnter}
          onMouseLeave={handleHoverLeave}
          style={{
            position: 'relative',
            background: chipBg,
            border: `2px solid ${chipBorder}`,
            borderRadius: '999px',
            padding: '3px 9px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: highlightRing,
            cursor: 'pointer',
            transform: selected ? 'scale(1.15)' : 'scale(1)',
            transition: 'transform 0.12s ease, box-shadow 0.12s ease, border 0.12s ease',
            whiteSpace: 'nowrap',
          }}
        >
          {newPostBadge}
          {newBuildBadge}
          <span style={{ fontSize: marker.hasRecentPrice ? '0.72rem' : '0.66rem', fontWeight: 800, color: selected ? '#1e293b' : (marker.hasRecentPrice ? 'var(--primary-hover)' : '#64748b') }}>
            {marker.price}
          </span>
        </div>
      );
    }

    return (
      <div
        onClick={handleClick}
        onMouseEnter={handleHoverEnter}
        onMouseLeave={handleHoverLeave}
        style={{
          background: chipBg,
          border: `2px solid ${chipBorder}`,
          borderRadius: '6px',
          padding: '4px 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxShadow: highlightRing,
          cursor: 'pointer',
          position: 'relative',
          transform: selected ? 'scale(1.08)' : 'scale(1)',
          transition: 'transform 0.12s ease, box-shadow 0.12s ease, border 0.12s ease',
        }}
      >
        {newPostBadge}
        {newBuildBadge}
        {/* 작은 말풍선 꼬리 */}
        <div style={{
          position: 'absolute',
          bottom: '-6px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '0',
          height: '0',
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `6px solid ${chipBorder}`
        }} />

        <span style={{ fontSize: '0.66rem', color: selected ? '#1e293b' : '#666', fontWeight: selected ? 800 : 600, whiteSpace: 'nowrap' }}>{marker.name}</span>
        <span style={{ fontSize: marker.hasRecentPrice ? '0.9rem' : '0.7rem', fontWeight: marker.hasRecentPrice ? 800 : 600, color: selected ? '#1e293b' : (marker.hasRecentPrice ? 'var(--text-primary)' : '#94a3b8'), whiteSpace: 'nowrap' }}>
          {marker.price}
        </span>
      </div>
    );
  };

  // 컴포넌트 첫 마운트 시, 사용자 위치 가져오기
  useEffect(() => {
    const fallbackToIp = async () => {
      try {
        const res = await fetch('https://ipinfo.io/json');
        const data = await res.json();
        if (data.loc) {
          const parts = data.loc.split(',');
          setCenter({ lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) });
        }
      } catch (e) {}
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCenter({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.log('위치 정보를 가져오지 못했습니다. IP 기반 위치를 시도합니다.', error);
          fallbackToIp();
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    } else {
      fallbackToIp();
    }
  }, []);

  // 드래그가 끝나면(연속 드래그 중이 아니라 'dragend' — 한 번만 발생) 바로 그 위치로
  // 마커를 다시 조회한다. "이 지역에서 재검색" 버튼을 거치던 이전 방식은 검색창 위에
  // 버튼이 겹쳐 뜨는 문제가 있었고, dragend 자체가 이미 드래그당 1회만 발생하는
  // 이벤트라 자동 갱신해도 과도한 API 호출로 이어지지 않는다.
  const handleDragEnd = () => {
    if (!mapRef.current) return;
    const c = mapRef.current.getCenter();
    const latLng = { lat: c.getLat(), lng: c.getLng() };
    setCenter(latLng);
    refreshActiveLayers(latLng.lat, latLng.lng);
  };

  const toggleLayer = (key: LayerKey) => {
    setLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // 이번에 새로 켠 레이어라면 현재 중심 기준으로 즉시 데이터를 채운다.
      if (!prev[key]) {
        if (key === 'apt') fetchAptMarkers(center.lat, center.lng);
        if (key === 'school') fetchSchoolMarkers(center.lat, center.lng);
      }
      return next;
    });
  };

  // 아파트 자동완성에서 단지를 선택하면 실제 kakao.maps.Map 인스턴스의 panTo로 부드럽게
  // 이동시킨다(마커 재조회 등으로 인한 리렌더가 center state를 되돌리지 못하도록 state도
  // 함께 갱신한다 — panTo만 호출하면 다음 setCenter 호출 없는 리렌더에서는 문제 없지만,
  // 이후 다른 흐름이 center state를 참조할 때 최신 위치와 어긋나는 것을 방지). 선택한 단지가
  // 있는 지역의 마커도 함께 새로 불러온다.
  const handleApartmentSelect = (result: ApartmentSearchResult) => {
    perfMark('map:m0-click'); // §12 M0
    const latLng = { lat: result.lat, lng: result.lng };
    setCenter(latLng);
    if (mapRef.current && window.kakao?.maps) {
      const anchor = new window.kakao.maps.LatLng(latLng.lat, latLng.lng);
      mapRef.current.panTo(anchor);
      if (mapRef.current.getLevel() > 3) {
        mapRef.current.setLevel(3, { anchor });
      }
    }
    // §16 — 검색 결과가 이미 lawdCd를 알고 있으면 이를 그대로 넘겨 마커 재조회 경로가
    // 자체 역지오코딩을 다시 하지 않게 한다(중복 요청 축소, 결과는 동일).
    refreshActiveLayers(latLng.lat, latLng.lng, result.lawdCd || undefined);

    if (result.type === 'APARTMENT') {
      const id = result.aptSeq || `${result.dong}-${result.name}`;
      setSelectedMarkerId(id);
      // §14 SELECTED MARKER FAST PATH — aptSeq + 좌표가 모두 있을 때만 임시 마커를
      // 만든다(name-only identity 금지, buildPendingSelectedApt가 강제). 가격은 아직
      // 모르므로 "정보 없음"으로 정직하게 표시하고, 실제 aptMarkers가 도착하면 위
      // resolveSelectedMarker/useEffect가 자동으로 대체한다.
      const pending = buildPendingSelectedApt({
        type: result.type,
        name: result.name,
        lat: latLng.lat,
        lng: latLng.lng,
        dong: result.dong,
        aptSeq: result.aptSeq,
        completionYear: result.completionYear,
      });
      setPendingSelectedApt(pending);
      if (pending) {
        // §12 M5 — 임시 fast-path 마커를 이 시점에 이미 state에 반영했다(다음 커밋에서
        // 렌더). 실제 네트워크 응답을 기다리지 않는다는 것이 이 계측의 핵심이다.
        perfMeasure('map: click→selected marker(fast path)', 'map:m0-click');
      }
    } else {
      setSelectedMarkerId(null);
      setPendingSelectedApt(null);
    }
  };

  if (!apiKey) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#FEE2E2', color: '#EF4444' }}>
        <h2>지도를 불러오는 데 실패했습니다.</h2>
        <p>카카오맵 API 키를 확인해주세요. (현재 키가 비어있습니다)</p>
        <button onClick={() => router.push('/')} style={{ marginTop: '2rem', padding: '1rem 2rem', background: 'white', border: '1px solid #EF4444', borderRadius: '8px', cursor: 'pointer' }}>돌아가기</button>
      </div>
    );
  }

  if (mapLoadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: '2rem', textAlign: 'center', backgroundColor: '#FEE2E2', color: '#EF4444' }}>
        <img src="/brand/mascot/ejipy-error.webp" alt="" style={{ width: 72, height: 72, marginBottom: '0.5rem' }} />
        <h2>지도를 불러오지 못했습니다.</h2>
        <p style={{ maxWidth: '480px', marginTop: '0.75rem' }}>{mapLoadError}</p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
          <button onClick={() => window.location.reload()} style={{ padding: '1rem 2rem', background: '#EF4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>다시 시도</button>
          <button onClick={() => router.push('/')} style={{ padding: '1rem 2rem', background: 'white', border: '1px solid #EF4444', borderRadius: '8px', cursor: 'pointer' }}>돌아가기</button>
        </div>
      </div>
    );
  }

  if (isLoadingData || !isMapReady) {
    return <FullPageLoader active message="지도 데이터를 불러오는 중입니다..." />;
  }

  // 요청된 순서: 단지 / 오피스텔 / 생숙 / 재개발 / 경·공매 / 학교
  const LAYER_LABEL: Record<LayerKey, string> = {
    apt: '단지',
    officetel: '오피스텔',
    livingLodging: '생숙',
    redevelopment: '재개발',
    auction: '경·공매',
    school: '학교',
  };
  const LAYER_ORDER: LayerKey[] = ['apt', 'officetel', 'livingLodging', 'redevelopment', 'auction', 'school'];
  const COMING_SOON_LAYERS: LayerKey[] = ['officetel', 'livingLodging', 'redevelopment', 'auction'];
  const COMING_SOON_MESSAGE: Partial<Record<LayerKey, string>> = {
    officetel: '오피스텔 실거래 데이터는 아직 연동 준비 중입니다.',
    livingLodging: '생활숙박시설(생숙) 실거래 데이터는 아직 연동 준비 중입니다.',
    redevelopment: '재개발/재건축 구역 데이터는 아직 연동 준비 중입니다.',
    auction: '경매/공매 매물 데이터는 아직 연동 준비 중입니다.',
  };
  const activeComingSoon = COMING_SOON_LAYERS.filter((key) => layers[key]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {/* 상단 컨트롤: 검색창 + 내 위치만 한 줄로(하단탭바에 홈 버튼이 항상 있어 "메인으로"
          버튼은 제거) — 검색창이 훨씬 넓게 쓰인다. */}
      <div
        style={{
          position: 'absolute', top: '16px', left: '16px', right: '16px', zIndex: 10,
          display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem',
          background: 'rgba(255, 255, 255, 0.95)', borderRadius: '99px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <ApartmentAutocomplete onSelect={handleApartmentSelect} placeholder="🔍 아파트, 오피스텔 단지명 검색..." />
        </div>
        <button
          onClick={async () => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  const latLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                  setCenter(latLng);
                  refreshActiveLayers(latLng.lat, latLng.lng);
                },
                async (err) => {
                  try {
                    const res = await fetch('https://ipinfo.io/json');
                    const data = await res.json();
                    if (data.loc) {
                      const parts = data.loc.split(',');
                      const latLng = { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
                      setCenter(latLng);
                      refreshActiveLayers(latLng.lat, latLng.lng);
                    }
                  } catch (e) {}
                },
                { enableHighAccuracy: false, timeout: 5000, maximumAge: 0 }
              );
            }
          }}
          style={{ flexShrink: 0, padding: '0.6rem 1rem', background: 'white', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '99px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, whiteSpace: 'nowrap', transition: 'background 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.background = '#f5f5f5'}
          onMouseOut={(e) => e.currentTarget.style.background = 'white'}
        >
          📍 내 위치
        </button>
      </div>

      {/* 우측 세로 카테고리 플로팅 바: 예전에는 상단을 가로로 가리던 걸 오른쪽 세로 알약
          칩으로 옮겨서 검색창/지도 상단이 안 가려지게 한다. */}
      <div style={{ position: 'absolute', right: '12px', top: '64px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {LAYER_ORDER.map((key) => (
          <button
            key={key}
            onClick={() => toggleLayer(key)}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '99px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.8rem',
              background: layers[key] ? 'var(--primary-color)' : 'rgba(255,255,255,0.95)',
              color: layers[key] ? 'white' : 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            {LAYER_LABEL[key]}
          </button>
        ))}
      </div>

      {/* 아직 데이터 연동이 안 된 레이어를 켰을 때: 지어낸 마커 대신 정직하게 준비중 안내 */}
      {activeComingSoon.length > 0 && (
        <div
          style={{
            position: 'absolute', bottom: '76px', left: '50%', transform: 'translateX(-50%)', zIndex: 10,
            padding: '0.75rem 1.25rem', background: 'rgba(30,41,59,0.92)', color: 'white', borderRadius: '12px',
            fontSize: '0.85rem', fontWeight: 600, textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            maxWidth: '90%',
          }}
        >
          {activeComingSoon.map((key) => COMING_SOON_MESSAGE[key]).join(' ')}
        </div>
      )}

      <KakaoMap
        ref={mapRef}
        center={center}
        style={{ width: '100%', height: '100%' }}
        level={4}
        onDragEnd={handleDragEnd}
        onZoomChanged={(map) => setZoomLevel(map.getLevel())}
        onClick={() => {
          setSelectedMarkerId(null);
          setPendingSelectedApt(null);
        }}
      >
        {layers.apt && aptClusters.map((cluster) => {
          if (cluster.markers.length > 1) {
            // 겹치는 칩들을 정사각형에 가까운 격자로 살짝 벌려서 그린다 — 숫자 배지
            // 하나로 뭉치면 이름/가격이 안 보인다는 피드백을 반영. 그룹 안에 선택된
            // 마커가 있으면 이 그룹 오버레이 전체를 다른 클러스터들보다 위로 올리고
            // (CustomOverlayMap의 zIndex), 그룹 내부에서도 선택된 칩 하나만 형제 칩들
            // 위로 올려(일반 CSS z-index — 같은 컨테이너 안이라 여기선 먹힌다) 완전히
            // 겹친 경우에도 항상 맨 위에서 보이게 한다.
            const cols = Math.ceil(Math.sqrt(cluster.markers.length));
            const rows = Math.ceil(cluster.markers.length / cols);
            const clusterSelected = cluster.markers.some((m) => m.id === activeMarkerId);
            return (
              <CustomOverlayMap
                key={cluster.id}
                position={{ lat: cluster.lat, lng: cluster.lng }}
                yAnchor={0.5}
                zIndex={clusterSelected ? 9999 : 1}
              >
                <div style={{ position: 'relative' }}>
                  {cluster.markers.map((marker, i) => {
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    const offsetX = (col - (cols - 1) / 2) * (chipLayout.width + chipLayout.gap);
                    const offsetY = (row - (rows - 1) / 2) * (chipLayout.height + chipLayout.gap);
                    const selected = marker.id === activeMarkerId;
                    return (
                      <div
                        key={marker.id}
                        style={{
                          position: 'absolute',
                          left: offsetX,
                          top: offsetY,
                          transform: 'translate(-50%, -50%)',
                          zIndex: selected ? 9999 : i,
                        }}
                      >
                        {renderMarkerChip(marker, selected)}
                      </div>
                    );
                  })}
                </div>
              </CustomOverlayMap>
            );
          }

          const marker = cluster.markers[0];
          const selected = marker.id === activeMarkerId;
          return (
            <CustomOverlayMap
              key={marker.id}
              position={{ lat: marker.lat, lng: marker.lng }}
              yAnchor={1} // 오버레이의 기준점 (1이면 마커 하단이 뾰족한 부분이 됨)
              zIndex={selected ? 9999 : 1}
            >
              <div style={{ transform: 'translateY(-10px)' }}>
                {renderMarkerChip(marker, selected)}
              </div>
            </CustomOverlayMap>
          );
        })}

        {/* §14 SELECTED MARKER FAST PATH — 실제 aptMarkers/aptClusters에 아직 이 id가
            없을 때만(위 useEffect가 도착 즉시 정리) 임시 마커를 그린다. 같은 renderMarkerChip을
            재사용해 진짜 마커와 시각적으로 동일하게 보이며, 진짜 데이터 도착 시 이 블록이
            사라지고 위 aptClusters 블록의 마커가 그 자리를 이어받아(같은 좌표) 중복 없이
            자연스럽게 교체된다. */}
        {layers.apt && pendingSelectedApt && (
          <CustomOverlayMap
            key={`pending-${pendingSelectedApt.id}`}
            position={{ lat: pendingSelectedApt.lat, lng: pendingSelectedApt.lng }}
            yAnchor={1}
            zIndex={9999}
          >
            <div style={{ transform: 'translateY(-10px)' }}>
              {renderMarkerChip(pendingSelectedApt, true)}
            </div>
          </CustomOverlayMap>
        )}

        {layers.school && schoolMarkers.map((school) => (
          <CustomOverlayMap key={school.id} position={{ lat: school.lat, lng: school.lng }} yAnchor={1}>
            <div
              onClick={() =>
                router.push(
                  `/school/${encodeURIComponent(school.id)}?name=${encodeURIComponent(school.name)}&lat=${school.lat}&lng=${school.lng}&lawdCd=${currentLawdCd}`
                )
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'white',
                border: `2px solid ${LEVEL_COLOR[school.level]}`,
                borderRadius: '999px',
                padding: '3px 8px 3px 4px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
              title={school.name}
            >
              <span style={{ background: LEVEL_COLOR[school.level], color: 'white', borderRadius: '999px', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800 }}>
                {school.level}
              </span>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)' }}>{school.name}</span>
            </div>
          </CustomOverlayMap>
        ))}
      </KakaoMap>

      {selectedMarker && (
        <div
          style={{
            position: 'fixed',
            bottom: '60px',
            left: 0,
            right: 0,
            zIndex: 1001,
            background: 'white',
            borderTop: '1px solid var(--border-color)',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.12)',
            padding: '1rem',
            borderRadius: '16px 16px 0 0',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedMarker.name}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{selectedMarker.dong}</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--primary-hover)', marginTop: '4px' }}>
                {selectedMarker.hasRecentPrice ? selectedMarker.price : '최근 실거래 정보 없음'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedMarkerId(null);
                setPendingSelectedApt(null);
              }}
              aria-label="닫기"
              style={{ padding: '0.4rem', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer', flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              router.push(`/apt/${encodeURIComponent(selectedMarker.name)}?lawdCd=${currentLawdCd}&dong=${encodeURIComponent(selectedMarker.dong)}`)
            }
            style={{ marginTop: '0.75rem', width: '100%', padding: '0.7rem', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: 'pointer' }}
          >
            상세보기
          </button>
          <AdContainer variant="agent" slot="map-marker-summary-agent" label="추천 지역 중개사" />
        </div>
      )}

      <BottomNav />
    </div>
  );
}
