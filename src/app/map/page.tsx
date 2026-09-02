'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Map as KakaoMap, CustomOverlayMap } from 'react-kakao-maps-sdk';
import ApartmentAutocomplete, { ApartmentSearchResult } from '@/components/ApartmentAutocomplete';
import { perfMark, perfMeasure } from '@/lib/perf-debug';
// AptMarker/AptCluster 타입과 selected-marker fast-path 판정 로직은
// src/lib/map-selected-marker.ts로 분리해 부작용 없이 단위 테스트한다(§26).
import type { AptMarker, AptCluster } from '@/lib/map-selected-marker';
import { buildPendingSelectedApt, resolveSelectedMarker, isPendingStillNeeded } from '@/lib/map-selected-marker';
import { isStaleMarkerResponse, isMarkerCacheFresh } from '@/lib/map-marker-fetch-guard';
import { formatMarkerPriceAreaLine, formatMarkerAreaLabel } from '@/lib/map-marker-format';
import {
  buildMapShareParams,
  parseMapStateFromSearchParams,
  matchRestoreIdentity,
  type RestoreIdentity,
} from '@/lib/map-marker-share';
import {
  computeSafeZoneNudge,
  computeNudgedCenterPoint,
  type SafeZoneRect,
  type Nudge,
} from '@/lib/map-control-safe-zone';
import FullPageLoader from '@/components/FullPageLoader';
import AdContainer from '@/components/AdContainer';
import BottomNav from '@/components/ui/BottomNav';
import ShareAction from '@/components/ShareAction';
import mapMarkerStyles from './map-marker.module.css';

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
// MAP MARKER UX V2 §12/§13 — 칩에 면적 정보가 추가되면서 내용 길이 자체는 기존
// "3억 8,700만"류 롱폼 가격과 비슷하거나 오히려 짧아진다(compact 포맷 "3.87억"
// 덕분) — 그래서 폭은 소폭만(60→64, 92→96) 늘리고 대신 padding을 줄여 실제
// 밀도를 높인다. clusterRadius도 늘어난 칩 폭에 맞춰 살짝(+2) 키워 인접
// 클러스터끼리 시각적으로 겹치지 않게 한다.
const CHIP_LAYOUT = {
  compact: { width: 64, height: 26, gap: 4, clusterRadius: 40 },
  detailed: { width: 96, height: 44, gap: 6, clusterRadius: 54 },
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

// GLOBAL SHARE SYSTEM V1 §12/§27 — 지도 center/zoom/lawdCd는 client-only state라 URL에
// 없다(감사 결과). 이 페이지는 useSearchParams() 훅 대신 KakaoShareButton과 동일한 관례로
// window.location.search를 직접 읽는다 — useSearchParams()는 페이지를 Suspense로 감싸야
// 하는데, 이 파일 자체가 별도 서버 래퍼 없는 단일 'use client' 페이지라 이번 STEP에서
// 그 구조를 새로 만들지 않는다(§12: map architecture 큰 변경 금지). useState의 lazy
// initializer 안에서만 값을 읽으므로 최초 마운트 이후의 인터랙션(드래그/줌/검색)에는
// 전혀 영향이 없다 — 공유 링크로 들어왔을 때만 시작 위치가 달라진다.
// MAP MARKER UX V2 §21~24 — selectedMarkerId 복원(known limitation이었던 부분)을 이번
// STEP에서 완성한다. 실제 파싱/매칭 로직은 src/lib/map-marker-share.ts의 순수 함수로
// 분리해 단위 테스트한다 — 이 함수는 window.location.search를 읽어 그 함수에 넘기기만
// 한다.
function readInitialMapStateFromUrl() {
  if (typeof window === 'undefined') return null;
  return parseMapStateFromSearchParams(new URLSearchParams(window.location.search));
}

export default function FullscreenMapPage() {
  const router = useRouter();

  const [aptMarkers, setAptMarkers] = useState<AptMarker[]>([]);
  const [aptClusters, setAptClusters] = useState<AptCluster[]>([]);
  const [schoolMarkers, setSchoolMarkers] = useState<SchoolMarker[]>([]);
  // 초기 진입 시 마커가 너무 빽빽하게 겹쳐 보이는 문제(레벨 6은 화면 안에 너무 넓은
  // 지역이 들어와 단지 밀집 지역에서 칩이 서로 겹침) — 레벨 4로 1~2단계 더 확대해
  // 시작하면 DETAIL_ZOOM_LEVEL(4) 기준 상세 카드 모드로 시작해 칩 간격이 넉넉해진다.
  // 공유 링크로 lat/lng/zoom이 왔으면(readInitialMapStateFromUrl) 그 값을 우선한다.
  const [zoomLevel, setZoomLevel] = useState(() => readInitialMapStateFromUrl()?.zoomLevel ?? 4);
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
  // MAP MARKER UX V2 §21~24 — 공유 링크에 aptSeq(또는 dong+name) identity가 실려
  // 있으면(readInitialMapStateFromUrl) 최초 마운트 이후 실제 aptMarkers가 도착할
  // 때까지 이 identity를 보관해둔다. pendingSelectedApt(fast-path 임시 마커)와
  // 달리 좌표를 모르는 상태이므로 가짜 마커를 만들지 않고, 실제 fetch 결과 안에서
  // "정확히 일치하는" 마커를 찾았을 때만 선택한다 — 못 찾으면 조용히 포기한다(§24
  // wrong-apartment fallback 금지).
  const [pendingRestoreIdentity, setPendingRestoreIdentity] = useState<RestoreIdentity | null>(
    () => readInitialMapStateFromUrl()?.restoreIdentity ?? null
  );
  // §18 SELECTED ANIMATION — 선택 직후 짧은 1회 emphasis만 트리거하기 위한 상태.
  // selectedMarkerId가 바뀔 때만 잠깐(260ms) 켜졌다 스스로 꺼진다 — 매 리렌더마다
  // 반복 재생되지 않도록 renderMarkerChip이 아니라 이 top-level effect 하나로만
  // 제어한다(마커별 hook 없이 안전하게 "방금 선택됨"을 판정).
  const [justSelectedId, setJustSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedMarkerId) return;
    setJustSelectedId(selectedMarkerId);
    const t = setTimeout(() => {
      setJustSelectedId((cur) => (cur === selectedMarkerId ? null : cur));
    }, 260);
    return () => clearTimeout(t);
  }, [selectedMarkerId]);
  // 현재 화면의 마커들을 조회할 때 실제로 사용한 lawdCd. 마커 클릭 시 상세페이지로 이 값을
  // 함께 넘겨야 한다 — 안 넘기면 상세페이지가 자기 자신의 하드코딩된 기본 지역(서울 강남구)으로
  // 실거래가를 조회해 엉뚱한 지역/빈 데이터가 뜨는 버그로 이어진다.
  const [currentLawdCd, setCurrentLawdCd] = useState(() => readInitialMapStateFromUrl()?.lawdCd ?? '26140');
  // MAP_SURROUNDING_MARKER_PERFORMANCE_V1 §14/§15 — 빠르게 연속으로 지역이 바뀌면(드래그
  // 두 번 연속 등) 먼저 보낸 요청의 응답이 나중에 보낸 요청보다 늦게 도착해 화면을 잘못된
  // 지역 마커로 덮어쓸 수 있다. 매 fetchAptMarkers 호출마다 증가하는 순번을 발급해, 응답이
  // 돌아왔을 때 자신이 여전히 "가장 최근 요청"인 경우에만 state에 반영한다(AbortController
  // 대신 단순 순번 비교 — 이미 Promise.all로 두 fetch를 묶고 있어 개별 abort보다 간단하고
  // 충분히 안전함). 같은 lawdCd로 짧은 시간 안에 재진입하면(예: 드래그로 벗어났다 복귀)
  // 네트워크 재요청 없이 즉시 반영하는 exact-key 캐시도 함께 둔다(ApartmentAutocomplete의
  // cacheRef와 동일 관례). 실거래 데이터라 무기한 캐시는 위험해 TTL을 짧게 둔다.
  const requestSeqRef = useRef(0);
  const markerCacheRef = useRef<Map<string, { markers: AptMarker[]; ts: number }>>(new Map());
  const MARKER_CACHE_TTL_MS = 60_000;
  const isDetailed = zoomLevel <= DETAIL_ZOOM_LEVEL;
  const chipLayout = isDetailed ? CHIP_LAYOUT.detailed : CHIP_LAYOUT.compact;
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapInstanceReady, setMapInstanceReady] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [center, setCenter] = useState(() => readInitialMapStateFromUrl()?.center ?? { lat: 35.0979, lng: 129.0244 }); // 기본: 부산광역시 서구
  // MAP MARKER UX V2 §21~24 — 공유 링크(lat/lng가 URL에 있음)로 들어왔을 때만 그
  // lawdCd를 기억해둔다. 최초 마커 로드가 이 값을 모르면(일반 진입) 기존과 동일하게
  // center 좌표를 역지오코딩해 lawdCd를 알아낸다 — 그런데 공유 링크로 들어왔을 때도
  // 이 knownLawdCd를 안 넘기면, 역지오코딩 결과가 원래 공유했던 lawdCd와 정확히
  // 일치하지 않을 수 있어(행정구역 경계 근처 좌표 등) 공유된 아파트가 그 결과에
  // 아예 없는 지역으로 잘못 조회될 수 있다 — selected identity 복원(matchRestoreIdentity)
  // 이 애초에 매칭될 기회조차 갖지 못하는 문제로 이어진다.
  const initialShareLawdCdRef = useRef(readInitialMapStateFromUrl()?.lawdCd ?? null);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    apt: true,
    officetel: false,
    livingLodging: false,
    redevelopment: false,
    auction: false,
    school: false,
  });
  const mapRef = useRef<any>(null);

  // MAP UI POLISH V1 §7~10 — 검색+공유 상단 바(top)와 우측 세로 레이어 토글(right)을
  // "control safe zone"으로 측정해둔다. 실제 DOM rect 기반(하드코딩 없음), mount와
  // 창 크기 변경 시에만 다시 재는다(§30 — scroll/mousemove마다 재는 layout thrash
  // 금지). 두 요소 다 지도 컨테이너(mapViewportRef)와 같은 뷰포트 전체 영역 안에
  // absolute로 배치돼 있어, viewport-relative rect에서 컨테이너 원점만 빼면 바로
  // projection의 container-point 좌표계와 일치한다.
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const topControlRowRef = useRef<HTMLDivElement | null>(null);
  const rightControlRef = useRef<HTMLDivElement | null>(null);
  const [safeZoneRects, setSafeZoneRects] = useState<{ top: SafeZoneRect | null; right: SafeZoneRect | null }>({ top: null, right: null });
  const [clusterNudges, setClusterNudges] = useState<Map<string, Nudge>>(new Map());

  useEffect(() => {
    const measure = () => {
      const origin = mapViewportRef.current?.getBoundingClientRect();
      if (!origin) return;
      const toRelative = (el: HTMLDivElement | null): SafeZoneRect | null => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
      };
      setSafeZoneRects({ top: toRelative(topControlRowRef.current), right: toRelative(rightControlRef.current) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isLoadingData, isMapReady]);

  // MAP MARKER UX V2 §21~24 — pendingRestoreIdentity(위에서 URL로부터 초기화)를
  // 실제 aptMarkers fetch가 끝난 뒤 한 번만 시도해서 매칭한다. isLoadingData가
  // false로 바뀐 시점(=fetchAptMarkers의 finally가 실행된 시점)에만 검사해야
  // 최초 마운트 시 아직 비어있는 aptMarkers([])를 "못 찾음"으로 오판하지 않는다.
  useEffect(() => {
    if (!pendingRestoreIdentity || isLoadingData) return;
    const match = matchRestoreIdentity(pendingRestoreIdentity, aptMarkers);
    if (match) setSelectedMarkerId(match.id);
    setPendingRestoreIdentity(null);
  }, [pendingRestoreIdentity, isLoadingData, aptMarkers]);

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
      const mySeq = ++requestSeqRef.current;

      // exact-key 캐시 히트 — 같은 lawdCd로 짧은 시간 안에 재진입하면 네트워크 요청 없이
      // 즉시 반영한다(예: 드래그로 벗어났다 다시 돌아오는 경우).
      const cached = markerCacheRef.current.get(lawdCd);
      if (cached && isMarkerCacheFresh(cached.ts, Date.now(), MARKER_CACHE_TTL_MS)) {
        setAptMarkers(cached.markers);
        setIsLoadingData(false);
        perfMeasure('map: click→surrounding markers ready', 'map:m0-click');
        return;
      }

      try {
        // 실거래 마커 데이터와 "최근 24시간 내 커뮤니티 글이 있는 단지" 집계는 서로
        // 무관한 조회라 Promise.all로 병렬 처리한다.
        const [res, activityRes] = await Promise.all([
          fetch(`/api/transactions?type=apt&lawdCd=${lawdCd}&months=12`),
          fetch(`/api/community/recent-activity`).catch(() => null),
        ]);
        const data = await res.json();
        if (!Array.isArray(data)) return;
        // §14 STALE BOUNDS REQUEST PROTECTION — 이 요청을 보낸 뒤 더 최신 요청이 발급됐으면
        // (사용자가 그 사이 다른 지역으로 다시 이동) 이 응답으로 화면을 덮어쓰지 않는다.
        if (isStaleMarkerResponse(mySeq, requestSeqRef.current)) return;

        let recentActivity: Record<string, number> = {};
        if (activityRes && activityRes.ok) {
          const activityJson = await activityRes.json();
          if (activityJson.success) recentActivity = activityJson.data || {};
        }

        // 단지별(name+dong) 최신 거래 1건만 남긴다 — 같은 단지의 여러 거래가 마커로
        // 중복 표시되는 것을 막는다. data는 이미 route.ts에서 계약일 최신순 정렬됨.
        // MAP MARKER UX V2 §7/§29 — 해제(취소)된 거래는 대표 거래 후보에서 제외한다.
        // route.ts는 dealCanceled를 필터링하지 않고 그대로 내려주므로(다른 소비자들은
        // 각자 필터링), 이 페이지가 "최신 거래"를 고를 때 취소 건을 건너뛰지 않으면
        // 취소된 가격이 마커에 뜨는 문제가 있었다 — 취소 건은 건너뛰어 그 다음(취소
        // 아닌) 최신 거래가 자연스럽게 대표가 되게 한다.
        const byComplex = new Map<string, any>();
        for (const item of data) {
          if (!item.lat || !item.lng) continue;
          if (item.dealCanceled) continue;
          const key = `${item.dong}|${item.name}`;
          if (!byComplex.has(key)) byComplex.set(key, item);
        }

        // §4/§8 — pyeong(trustworthy Unit Master만, route.ts가 이미 검증)과
        // excluUseArea(raw ㎡)/dealAmount(만원)는 대표 거래로 고른 같은 item에서
        // 그대로 꺼낸다 — 가격과 면적이 항상 같은 거래 identity를 공유하도록 보장.
        const markers: AptMarker[] = Array.from(byComplex.values()).map((item: any) => ({
          id: item.aptSeq || `${item.dong}-${item.name}`,
          aptSeq: item.aptSeq,
          completionYear: item.completionYear,
          name: item.name,
          dong: item.dong || '',
          price: item.price || '시세 정보 없음',
          hasRecentPrice: !!item.price,
          dealAmount: typeof item.dealAmount === 'number' && item.dealAmount > 0 ? item.dealAmount : null,
          pyeong: typeof item.pyung === 'number' ? item.pyung : null,
          areaM2: typeof item.excluUseArea === 'number' ? item.excluUseArea : null,
          lat: item.lat,
          lng: item.lng,
          hasNewPost: (recentActivity[item.name] || 0) > 0,
        }));

        markerCacheRef.current.set(lawdCd, { markers, ts: Date.now() });
        setAptMarkers(markers);
        // §12 M6 — 주변 마커 전체 dataset 준비 완료(M0 클릭 흐름에서 호출된 경우에만
        // 의미 있음 — 드래그/현재위치 등 다른 호출부에서도 공유되는 mark라 클릭 흐름이
        // 아닐 때는 이 measure가 실패해도(시작 mark 없음) 무해하게 무시된다).
        perfMeasure('map: click→surrounding markers ready', 'map:m0-click');
      } catch (error) {
        console.error('Failed to fetch apt markers:', error);
      } finally {
        if (!isStaleMarkerResponse(mySeq, requestSeqRef.current)) setIsLoadingData(false);
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
    // MAP UI POLISH V1 §7/§8 — 클러스터별로 이미 계산해둔 화면 픽셀 평균 위치(avgX/avgY)
    // 를 그대로 재사용해 top/right control safe-zone과 겹치는지 판정하고, 겹치면
    // 최소한만 밀어내는 오프셋을 함께 계산해둔다(clustering 반경/그룹핑 로직 자체는
    // 전혀 바뀌지 않음 — §17 "clustering algorithm 광범위 rewrite 금지"). 이 오프셋은
    // 렌더링 시 CSS 위치에만 더해지고 marker의 실제 lat/lng/식별자는 그대로다(§9 —
    // 데이터를 지우거나 바꾸지 않음).
    const nudges = new Map<string, Nudge>();

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
      const avgX = group.reduce((s, g) => s + g.x, 0) / group.length;
      const avgY = group.reduce((s, g) => s + g.y, 0) / group.length;
      const clusterId = group.map((g) => g.marker.id).join(',');
      result.push({
        id: clusterId,
        lat: avgLat,
        lng: avgLng,
        markers: group.map((g) => g.marker),
      });
      nudges.set(
        clusterId,
        computeSafeZoneNudge({ x: avgX, y: avgY }, chipLayout.width / 2, chipLayout.height / 2, safeZoneRects.top, safeZoneRects.right)
      );
    });

    setAptClusters(result);
    setClusterNudges(nudges);
  };

  // §14 SELECTED MARKER FAST PATH 전용 — pendingSelectedApt는 aptClusters에 속하지
  // 않아 위에서 미리 계산한 clusterNudges에 없다. mapRef.current를 읽으므로(ref) 렌더
  // 중에는 절대 호출하지 않고(react-hooks/refs), pendingSelectedApt가 바뀔 때만 아래
  // effect 안에서 한 번 계산해 state(pendingNudge)에 저장한다 — 렌더는 그 state만 읽는다.
  const getNudgeForLatLng = useCallback(
    (lat: number, lng: number): Nudge => {
      const map = mapRef.current;
      if (!map || !window.kakao?.maps) return { dx: 0, dy: 0 };
      const projection = map.getProjection();
      if (!projection) return { dx: 0, dy: 0 };
      const p = projection.containerPointFromCoords(new window.kakao.maps.LatLng(lat, lng));
      return computeSafeZoneNudge({ x: p.x, y: p.y }, chipLayout.width / 2, chipLayout.height / 2, safeZoneRects.top, safeZoneRects.right);
    },
    [chipLayout.width, chipLayout.height, safeZoneRects]
  );
  const [pendingNudge, setPendingNudge] = useState<Nudge>({ dx: 0, dy: 0 });
  useEffect(() => {
    if (!pendingSelectedApt) {
      setPendingNudge({ dx: 0, dy: 0 });
      return;
    }
    setPendingNudge(getNudgeForLatLng(pendingSelectedApt.lat, pendingSelectedApt.lng));
  }, [pendingSelectedApt, getNudgeForLatLng]);

  // 최초 지도 준비 완료 + center 확정 시 최초 1회 로드. 공유 링크로 들어왔으면
  // (initialShareLawdCdRef) 그 lawdCd를 그대로 써서 역지오코딩 왕복과 그로 인한
  // lawdCd 불일치 위험을 건너뛴다 — 일반 진입은 기존과 동일하게 undefined를 넘겨
  // 역지오코딩 경로를 그대로 탄다(회귀 없음).
  useEffect(() => {
    if (!isMapReady) return;
    setIsLoadingData(true);
    refreshActiveLayers(center.lat, center.lng, initialShareLawdCdRef.current ?? undefined);
  }, [isMapReady]);

  // react-kakao-maps-sdk의 <Map ref={mapRef}>는 실제 kakao.maps.Map 인스턴스를 자기 내부
  // useEffect에서 비동기로 생성한 뒤에야 ref에 채워준다 — 그래서 "로딩 게이트를 지난 그
  // 커밋"에서 곧바로 mapRef.current를 참조하는 effect는 항상 null을 보고 조기 종료됐다
  // (ref 자체는 리액트 렌더 트리거가 아니라 effect 재실행도 안 됨 → 클러스터가 영원히
  // 빈 배열로 남아 마커가 하나도 안 그려지는 회귀로 이어졌다). SDK 로드 감지와 같은 이
  // 파일의 기존 관례(위 checkKakao setInterval)를 그대로 따라 짧은 폴링으로 실제 인스턴스
  // 생성을 기다린다.
  useEffect(() => {
    // MAP_PERFORMANCE_V1 — isLoadingData(마커 fetch 완료 여부)를 의존성에서 뺐다.
    // 렌더 게이트가 이미 isMapReady만 보고 KakaoMap을 마운트하므로, mapRef.current가
    // 채워지는 시점도 마커 완료와 무관해졌다 — 그 타이밍을 그대로 따라간다.
    if (!isMapReady) return;
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
  }, [isMapReady]);

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
  }, [mapInstanceReady, aptMarkers, zoomLevel, safeZoneRects]);

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
    const justSelected = justSelectedId === marker.id;

    const accent = marker.hasRecentPrice ? 'var(--primary-color)' : '#94a3b8';

    // MAP MARKER UX V2 §15~17 — 검은 강조(#1e293b) 링/보더를 제거하고 이집 Green
    // fill(선택) + 연한 green halo로 교체한다. non-selected 스타일은 기존과 동일
    // (회귀 없음).
    const highlightRing = selected
      ? '0 0 0 6px rgba(19, 163, 103, 0.18), 0 6px 14px rgba(0,0,0,0.18)'
      : '0 2px 5px rgba(0,0,0,0.12)';

    const chipBg = selected ? 'var(--ejip-green)' : (isNewBuild ? '#f0fdf4' : (marker.hasRecentPrice ? 'white' : '#f8fafc'));
    const chipBorder = selected ? 'var(--ejip-green-deep)' : (isNewBuild ? accent : (marker.hasRecentPrice ? accent : '#cbd5e1'));
    // 기존 compact/detailed 텍스트 색상 매핑을 그대로 유지하고(회귀 없음), 선택 시에만
    // 검은색(#1e293b) 대신 white로 바꾼다(§15~17).
    const compactPriceText = selected ? 'white' : (marker.hasRecentPrice ? 'var(--primary-hover)' : '#64748b');
    const detailedNameText = selected ? 'white' : '#666';
    const detailedPriceText = selected ? 'white' : (marker.hasRecentPrice ? 'var(--text-primary)' : '#94a3b8');

    // §5/§9 CORE MARKER INFORMATION CONTRACT — 가격 옆에 그 가격이 어느 면적
    // 기준인지(평/㎡) 항상 함께 보여준다. price/area는 fetchAptMarkers에서 항상
    // 같은 거래(item) 하나에서 함께 꺼낸 값이라 identity가 어긋나지 않는다(§8).
    const priceAreaLine = marker.hasRecentPrice
      ? (formatMarkerPriceAreaLine(marker.dealAmount, marker.pyeong, marker.areaM2) || marker.price)
      : marker.price;

    const handleHoverEnter = () => setHoveredMarkerId(marker.id);
    const handleHoverLeave = () => setHoveredMarkerId((cur) => (cur === marker.id ? null : cur));
    const handleClick = () => {
      if (selectedMarkerId === marker.id) {
        const aptSeqParam = marker.aptSeq ? `&aptSeq=${encodeURIComponent(marker.aptSeq)}` : '';
        router.push(`/apt/${encodeURIComponent(marker.name)}?lawdCd=${currentLawdCd}&dong=${encodeURIComponent(marker.dong)}${aptSeqParam}`);
      } else {
        setSelectedMarkerId(marker.id);
      }
    };
    // §36 ACCESSIBILITY — 마커 칩은 기존에 키보드로 전혀 접근할 수 없었다(plain
    // div, tabIndex 없음). Enter/Space로 동일한 클릭 동작을 쓸 수 있게 하고,
    // 선택 상태를 색상뿐 아니라 aria-pressed로도 전달한다.
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    };
    const ariaLabel = marker.hasRecentPrice
      ? `${marker.name}, ${priceAreaLine}${selected ? ', 선택됨' : ''}`
      : `${marker.name}, 최근 실거래 정보 없음${selected ? ', 선택됨' : ''}`;
    const popClassName = justSelected ? (isDetailed ? mapMarkerStyles.markerPopDetailed : mapMarkerStyles.markerPopCompact) : '';

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
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          aria-label={ariaLabel}
          onKeyDown={handleKeyDown}
          className={`${mapMarkerStyles.markerChip} ${popClassName}`}
          style={{
            position: 'relative',
            background: chipBg,
            border: `2px solid ${chipBorder}`,
            borderRadius: '999px',
            padding: '2.5px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: highlightRing,
            cursor: 'pointer',
            transform: selected ? 'scale(1.1)' : 'scale(1)',
            transition: 'transform 0.12s ease, box-shadow 0.12s ease, border 0.12s ease, background 0.12s ease',
            whiteSpace: 'nowrap',
          }}
        >
          {newPostBadge}
          {newBuildBadge}
          <span style={{ fontSize: marker.hasRecentPrice ? '0.68rem' : '0.64rem', fontWeight: 800, color: compactPriceText }}>
            {priceAreaLine}
          </span>
        </div>
      );
    }

    return (
      <div
        onClick={handleClick}
        onMouseEnter={handleHoverEnter}
        onMouseLeave={handleHoverLeave}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className={`${mapMarkerStyles.markerChip} ${popClassName}`}
        style={{
          background: chipBg,
          border: `2px solid ${chipBorder}`,
          borderRadius: '6px',
          padding: '3px 7px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxShadow: highlightRing,
          cursor: 'pointer',
          position: 'relative',
          transform: selected ? 'scale(1.08)' : 'scale(1)',
          transition: 'transform 0.12s ease, box-shadow 0.12s ease, border 0.12s ease, background 0.12s ease',
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

        <span style={{ fontSize: '0.64rem', color: detailedNameText, fontWeight: selected ? 800 : 600, whiteSpace: 'nowrap' }}>{marker.name}</span>
        <span style={{ fontSize: marker.hasRecentPrice ? '0.84rem' : '0.7rem', fontWeight: marker.hasRecentPrice ? 800 : 600, color: detailedPriceText, whiteSpace: 'nowrap' }}>
          {priceAreaLine}
        </span>
      </div>
    );
  };

  // 컴포넌트 첫 마운트 시, 사용자 위치 가져오기.
  // MAP MARKER UX V2 §9-b/§23 — 공유 링크로 들어왔으면(initialShareLawdCdRef) URL의
  // center를 그대로 유지해야 한다. 이 효과가 무조건 실행되면 GPS/IP 기반 위치로 그
  // center를 곧바로 덮어써버려(발견: 실측 — 공유 링크 center가 GPS/IP 위치와 다른
  // 지역이면 마운트 직후 조용히 원래 위치로 되돌아가는 회귀), "선택된 단지가 있는
  // 지역"이 아니라 사용자의 현재 물리적 위치로 지도가 튀는 문제가 있었다.
  useEffect(() => {
    if (initialShareLawdCdRef.current) return;
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
      const map = mapRef.current;
      map.panTo(anchor);
      if (map.getLevel() > 3) {
        map.setLevel(3, { anchor });
      }
      // MAP UI POLISH V1 §11/§12 — 검색으로 선택한 단지를 정중앙에 놓으면(panTo) 그
      // 지점이 상단/우측 control safe-zone과 겹칠 수 있다(좁은 뷰포트, 클러스터 격자
      // 오프셋 등). pan/zoom 애니메이션이 끝난 뒤 실제 투영 좌표를 기준으로 딱 한 번만
      // 확인해 필요한 경우에만 최소한으로 center를 보정한다 — panBy의 부호를 추측하지
      // 않고 coordsFromContainerPoint의 역변환 성질만 이용한다(computeNudgedCenterPoint,
      // 정확도 보장). 과도한 이동 방지: 겹친 만큼만 보정하고, 겹치지 않으면 아무것도
      // 하지 않는다.
      setTimeout(() => {
        const projection = map.getProjection?.();
        if (!projection) return;
        const point = projection.containerPointFromCoords(anchor);
        const nudge = computeSafeZoneNudge(
          { x: point.x, y: point.y },
          chipLayout.width / 2,
          chipLayout.height / 2,
          safeZoneRects.top,
          safeZoneRects.right
        );
        if (nudge.dx === 0 && nudge.dy === 0) return;
        const correctedPoint = computeNudgedCenterPoint(point, nudge);
        const correctedLatLng = projection.coordsFromContainerPoint(
          new window.kakao.maps.Point(correctedPoint.x, correctedPoint.y)
        );
        map.panTo(correctedLatLng);
      }, 350);
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

  // MAP_PERFORMANCE_V1 — 이전에는 SDK 준비(isMapReady)와 마커 데이터 준비
  // (isLoadingData) 둘 다 끝나야 지도 자체(KakaoMap)가 마운트됐다 — 즉 지도가
  // 뜨기까지의 시간이 "SDK 로드 시간 + 마커 fetch 시간"의 합이었다. 마커 fetch는
  // Kakao 역지오코딩(서비스 라이브러리 필요) 뒤에 서버 API까지 왕복하므로 SDK
  // 로드보다 항상 오래 걸린다 — 사용자는 지도를 조작할 수 있는데도 그보다 훨씬
  // 오래 흰 화면에 갇혀 있었다. SDK만 준비되면 즉시 지도를 띄우고, 마커는
  // 준비되는 대로 점진적으로 그려지게 한다(§14/§42 — 마커 미완료가 pan/zoom을
  // 막지 않아야 한다는 요구사항 그대로). 아래 두 곳의 관련 effect도 동일하게
  // isLoadingData 의존을 제거했다(§ mapInstanceReady 관련 useEffect).
  if (!isMapReady) {
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
    <div ref={mapViewportRef} style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {/* MAP UI POLISH V1 §5 — 검색바(+내 위치)는 흰 알약 하나로 묶고, 공유 버튼은 그
          옆에 완전히 독립된 원형 버튼으로 분리한다("검색바 내부에 넣지 않음"). 이 바깥
          row 전체(topControlRowRef)를 top safe-zone 측정 기준으로 쓴다 — 검색 결과
          드롭다운(ApartmentAutocomplete 내부)은 이 row 안의 상대 위치에서 자연스럽게
          그 위에 뜨므로 순서/zIndex 변경 없이 그대로 유지된다. */}
      <div
        ref={topControlRowRef}
        style={{
          position: 'absolute', top: '16px', left: '16px', right: '16px', zIndex: 10,
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}
      >
        <div
          style={{
            flex: 1, minWidth: 0,
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
        <ShareAction
          variant="icon"
          tone="brand"
          title={selectedMarker ? `${selectedMarker.name} 위치 | 이집` : '아파트 지도 | 이집'}
          text="실거래가 기반 아파트 위치를 이집 지도에서 확인하세요."
          // MAP MARKER UX V2 §21~24 — 선택된 단지가 있으면 aptSeq(없으면 dong+name)
          // identity를 함께 실어 보내 공유받은 사람이 같은 단지가 선택된 상태로 지도를
          // 연다(buildMapShareParams가 우선순위/name-only 금지를 강제). URL contract는
          // 이번 STEP에서 전혀 바뀌지 않았다(§15/§21).
          params={buildMapShareParams(center, zoomLevel, currentLawdCd, selectedMarker)}
        />
      </div>

      {/* 우측 세로 카테고리 플로팅 바: 예전에는 상단을 가로로 가리던 걸 오른쪽 세로 알약
          칩으로 옮겨서 검색창/지도 상단이 안 가려지게 한다. rightControlRef는 이 영역을
          right safe-zone으로 측정하는 기준이다(§7/§10). */}
      <div ref={rightControlRef} style={{ position: 'absolute', right: '12px', top: '64px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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

      {/* MAP_PERFORMANCE_V1 — 지도 자체는 이미 떴고(isMapReady) 주변 마커만 아직
          fetch 중일 때 보여주는 작은, 화면을 막지 않는 안내. 예전 FullPageLoader처럼
          지도 전체를 가리지 않고, 사용자가 그 사이에도 바로 pan/zoom할 수 있다(§42). */}
      {isLoadingData && (
        <div
          style={{
            position: 'absolute', bottom: '76px', left: '50%', transform: 'translateX(-50%)', zIndex: 10,
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.95)', borderRadius: '99px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)',
          }}
          role="status"
          aria-live="polite"
        >
          <span
            className={mapMarkerStyles.markerLoadingSpinner}
            style={{
              display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%',
              border: '2px solid rgba(0,0,0,0.15)', borderTopColor: 'var(--primary-color)',
            }}
            aria-hidden="true"
          />
          주변 매물을 불러오는 중...
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
          setPendingRestoreIdentity(null);
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
            // MAP UI POLISH V1 §7/§8 — control safe-zone과 겹치면 클러스터 전체를
            // 화면상에서만 밀어낸다(lat/lng는 그대로, 클릭/식별자 영향 없음).
            const nudge = clusterNudges.get(cluster.id) ?? { dx: 0, dy: 0 };
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
                    const offsetX = (col - (cols - 1) / 2) * (chipLayout.width + chipLayout.gap) + nudge.dx;
                    const offsetY = (row - (rows - 1) / 2) * (chipLayout.height + chipLayout.gap) + nudge.dy;
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
          const nudge = clusterNudges.get(cluster.id) ?? { dx: 0, dy: 0 };
          return (
            <CustomOverlayMap
              key={marker.id}
              position={{ lat: marker.lat, lng: marker.lng }}
              yAnchor={1} // 오버레이의 기준점 (1이면 마커 하단이 뾰족한 부분이 됨)
              zIndex={selected ? 9999 : 1}
            >
              <div style={{ transform: `translate(${nudge.dx}px, ${nudge.dy - 10}px)` }}>
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
            <div style={{ transform: `translate(${pendingNudge.dx}px, ${pendingNudge.dy - 10}px)` }}>
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
                {selectedMarker.hasRecentPrice
                  ? (formatMarkerPriceAreaLine(selectedMarker.dealAmount, selectedMarker.pyeong, selectedMarker.areaM2) || selectedMarker.price)
                  : '최근 실거래 정보 없음'}
              </div>
              {/* §25 AREA LABEL COLLISION — 마커/칩에는 대표 평형만 보이므로, 카드에서는
                  같은 거래의 raw ㎡도 함께 확인할 수 있게 한다. */}
              {selectedMarker.hasRecentPrice && selectedMarker.pyeong != null && selectedMarker.areaM2 != null && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  전용 {selectedMarker.areaM2}㎡
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedMarkerId(null);
                setPendingSelectedApt(null);
                setPendingRestoreIdentity(null);
              }}
              aria-label="닫기"
              style={{ padding: '0.4rem', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer', flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              const aptSeqParam = selectedMarker.aptSeq ? `&aptSeq=${encodeURIComponent(selectedMarker.aptSeq)}` : '';
              router.push(`/apt/${encodeURIComponent(selectedMarker.name)}?lawdCd=${currentLawdCd}&dong=${encodeURIComponent(selectedMarker.dong)}${aptSeqParam}`);
            }}
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
