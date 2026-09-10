'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Map as KakaoMap, CustomOverlayMap } from 'react-kakao-maps-sdk';
import ApartmentAutocomplete, { ApartmentSearchResult } from '@/components/ApartmentAutocomplete';
import { perfMark, perfMeasure, perfLog, perfNow, PERF_ENABLED } from '@/lib/perf-debug';
import { loadKakaoMapsSdk } from '@/lib/kakao/maps-sdk';
// AptMarker/AptCluster 타입과 selected-marker fast-path 판정 로직은
// src/lib/map-selected-marker.ts로 분리해 부작용 없이 단위 테스트한다(§26).
import type { AptMarker, AptCluster } from '@/lib/map-selected-marker';
import { buildPendingSelectedApt, resolveSelectedMarker, isPendingStillNeeded } from '@/lib/map-selected-marker';
import { isStaleMarkerResponse, isMarkerCacheFresh } from '@/lib/map-marker-fetch-guard';
import { REPORT_LABELS } from '@/lib/report/report-links';
import { resolveTransactionsReadState } from '@/lib/trade-read-state';
import { formatMarkerPriceAreaLine, formatMarkerAreaLabel } from '@/lib/map-marker-format';
import {
  buildMapShareParams,
  buildMapRestoreParams,
  mapParamsToQueryString,
  parseMapStateFromSearchParams,
  matchRestoreIdentity,
  aptMarkerRequestPath,
  bootPrefetchLawdCd,
  isDefaultMapCenter,
  DEFAULT_LAWD_CD,
  DEFAULT_MAP_CENTER,
  type RestoreIdentity,
} from '@/lib/map-marker-share';

// PERCEIVED_PERFORMANCE_V2_4 §1 — map/layout.tsx의 부트 스크립트가 심어두는 값.
declare global {
  interface Window {
    __EJIP_APT_BOOT__?: { lawdCd: string; promise: Promise<{ ok: boolean; body: unknown }> };
  }
}
import {
  computeSafeZoneNudge,
  computeNudgedCenterPoint,
  type SafeZoneRect,
  type Nudge,
} from '@/lib/map-control-safe-zone';
// OFFICETEL_MAP_LAYER_V1 — 오피스텔 레이어의 순수 계약(좌표 유효성/identity/상한).
import {
  OFFICETEL_RENDER_CAP,
  officetelMarkerAddressLine,
  type OfficetelLayerStatus,
  type OfficetelMapMarker,
} from '@/lib/officetel/map-marker-contract';
// MAP_UX_V2 — 포커스 모드/확대 밀도/동일 좌표 그룹핑의 순수 규칙.
import {
  INDIVIDUAL_MARKER_MAX_LEVEL,
  MIXED_OFFICETEL_INDIVIDUAL_MAX_LEVEL,
  OFFICETEL_MAX_ZOOM_LEVEL,
  ensurePropertyLayerVisible,
  findExactOfficetelMarker,
  groupByExactCoordinate,
  hasNoPropertyLayer,
  hasUsableHandoffCoords,
  isMixedPropertyMode,
  markerDensityMode,
  mixedOverlapOffsetY,
  propertyLayerForSearchResult,
  showsOfficetelName,
  togglePropertyLayer,
  type PropertyTypeLayer,
} from '@/lib/map-property-focus';
import { Building2, Home } from 'lucide-react';
import FullPageLoader from '@/components/FullPageLoader';
import KakaoPreconnect from '@/components/KakaoPreconnect';
import AdContainer from '@/components/AdContainer';
import BottomNav from '@/components/ui/BottomNav';
import ShareAction from '@/components/ShareAction';
import mapMarkerStyles from './map-marker.module.css';

// [DESIGN SYSTEM 3 §9] 지도 페이지는 전체화면 커스텀 UI라 Header를 아예
// 렌더링하지 않으므로(상단 로고바가 지도를 가리는 걸 막기 위함) 하단탭바만
// 공용 BottomNav 컴포넌트로 별도 렌더링한다 — 기존에는 이 페이지가 동일한
// 마크업/스타일을 인라인으로 직접 그렸는데, Header.tsx의 모바일 버전과
// 로직이 갈라질 위험이 있어 공용 컴포넌트로 대체했다(시각적 변경 없음).

// PERCEIVED_PERFORMANCE_V2_5 §1 — 라우트 JS가 실제로 **실행**된 시점.
// 다운로드 완료(resource timing)와 실행 시작은 다르다 — 둘 사이가 파싱/컴파일 비용이다.
perfLog("map:module-eval", { t: perfNow() });

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

// 요청된 6개 카테고리. apt/school/officetel은 실제 데이터로 동작한다 —
// apt는 MOLIT 실거래, school은 카카오 학교 POI, officetel은 OFFICETEL_V1에서 적재한
// `officetel_masters`의 **저장된 좌표**(5,048/5,056 실측)를 쓴다. livingLodging/
// redevelopment/auction은 아직 연동된 데이터 소스가 없어 지어낸 마커 대신 정직하게
// "준비 중" 안내만 띄운다.
type LayerKey = 'apt' | 'officetel' | 'livingLodging' | 'redevelopment' | 'auction' | 'school';

// OFFICETEL_MAP_LAYER_V1 §7 — 오피스텔 칩은 아파트 칩과 크기/모양이 다르다. 축소
// 상태에서는 가격이 없는 만큼 이름 라벨을 늘어놓지 않고 작은 원형 배지(위치+종류)만
// 그리고, 확대해야 이름이 함께 보이는 라벨 칩으로 전환된다. 클러스터 반경도 각 칩의
// 실제 렌더 크기에 맞춘 값을 쓴다(아파트용 CHIP_LAYOUT을 그대로 쓰면 어긋난다).
const OFFICETEL_CHIP_LAYOUT = {
  compact: { width: 34, height: 30, gap: 3, clusterRadius: 30 },
  detailed: { width: 112, height: 30, gap: 5, clusterRadius: 62 },
};

// MAP_UX_V2 §3 — 매물 종류 색 체계. 아파트는 기존 이집 Green 그대로, 오피스텔은
// teal(#0f766e)에서 **파랑**으로 옮긴다 — V1의 teal이 초록과 너무 가까워 작은 모바일
// 화면에서 종류가 구분되지 않는다는 실사용 피드백을 받았다. 색만으로 구분하지 않도록
// 건물 아이콘/모양/가격 유무(§3 접근성)도 함께 다르게 유지한다.
const OFFI = {
  line: '#1d4ed8',      // 기본 외곽선/아이콘
  lineStrong: '#1e3a8a', // 선택 시 외곽선
  fill: '#1d4ed8',      // 선택 시 배경
  soft: '#dbeafe',      // 연한 배경
  ring: '0 0 0 6px rgba(29, 78, 216, 0.20), 0 6px 14px rgba(0,0,0,0.18)',
  banner: 'rgba(30, 64, 175, 0.94)',
};

// §9 — 아파트 묶음 마커(축소 상태). 아파트는 초록 계열을 그대로 쓴다.
const APT_GROUP_CHIP = { width: 40, height: 28, gap: 3, clusterRadius: 34 };
// 뷰포트 밖 마커는 그리지 않는다(§19 DOM 상한). 여유분을 둬서 살짝 패닝했을 때
// 마커가 뒤늦게 튀어나오는 느낌을 줄인다.
const OFFICETEL_VIEWPORT_MARGIN_PX = 160;

// PERCEIVED_PERFORMANCE_V2_3 §3 — 아파트 레이어의 뷰포트 컬링 여유분.
//
// 왜 필요한가(실측): 부산진구는 마커 356개가 오는데, 이 페이지는 그 **전부**를
// clusterMarkersByPixels(… viewport=null)로 넘겨 293개 클러스터를 만들고 각각에
// CustomOverlayMap을 하나씩 렌더했다. 그런데 360px 화면에 실제로 그려진 칩은 29개뿐이다
// — kakao CustomOverlay는 화면 밖이면 content를 DOM에 붙이지 않아서(=portal 대상인
// parentElement가 null) 나머지 264개는 **아무것도 보여주지 않으면서** 생성/부착 비용만
// 냈다. 4x CPU throttling 실측(map:overlay:apt): 부산진구 664~775ms, 해운대구 511~552ms.
// 같은 조건에서 클러스터링 자체는 19~33ms로, 렌더 비용의 ~96%가 오버레이 생성이었다.
//
// 여유분을 클러스터 반경(최대 54px)보다 훨씬 크게 잡는 이유: 화면에 **보이는** 묶음
// 배지의 개수가 컬링 때문에 실제보다 적게 나오면 안 된다. 클러스터 중심이 화면 안이면
// 그 멤버는 중심에서 최대 clusterRadius(≤54px) 안에 있으므로, 여유분이 그보다 크면
// 보이는 배지의 개수는 컬링 전과 항상 같다(§5 identity/개수 보존).
//
// 값은 오피스텔과 같은 160px로 맞췄다 — 240px도 재봤지만(4x CPU, map:overlay:apt)
// 부산진구 360px 250.6ms / 1280px 454.4ms 대 160px의 196.2ms / 356.4ms로 160px이
// 모든 구·폭에서 더 빨랐고, 이미 배포되어 검증된 오피스텔 레이어와 값이 갈리지 않는다.
const APT_VIEWPORT_MARGIN_PX = 160;

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

// OFFICETEL_MAP_LAYER_V1 §5 — 기존 아파트 클러스터링(화면 픽셀 거리 기준 그리디 그룹핑 +
// safe-zone 넛지)을 **알고리즘 변경 없이** 제네릭으로 뽑아 오피스텔 레이어가 그대로
// 재사용한다. 아파트 호출부는 viewport=null을 넘겨 이전과 완전히 동일하게 동작한다
// (§23 아파트 회귀 금지). 오피스텔만 뷰포트 컬링을 켠다.
interface PixelClusterable {
  id: string;
  lat: number;
  lng: number;
}

interface PixelCluster<T extends PixelClusterable> {
  id: string;
  lat: number;
  lng: number;
  markers: T[];
}

// MAP_UX_V2 §8 — 좌표가 완전히 같은 오피스텔 master들의 **표시 전용** 묶음.
// 데이터는 합쳐지지 않는다: members 각각이 자기 officetelId/canonicalKey를 유지한다.
interface OfficetelCoordGroup {
  id: string;
  lat: number;
  lng: number;
  members: OfficetelMapMarker[];
}

function clusterMarkersByPixels<T extends PixelClusterable>(
  projection: any,
  markers: T[],
  layout: { width: number; height: number; clusterRadius: number },
  safeZone: { top: SafeZoneRect | null; right: SafeZoneRect | null },
  viewport: { width: number; height: number; margin: number } | null,
  // PERCEIVED_PERFORMANCE_V2_3 §3 — 뷰포트 컬링을 **면제**할 마커 id.
  // 선택/고정된 마커는 화면 밖으로 밀려나도 클러스터 목록에 남아 있어야 한다:
  // selectedMarker(바텀시트)와 pinnedMarker(공유·복원 URL)가 둘 다
  // resolveSelectedMarker(…, aptClusters, …)로 **클러스터에서** 찾기 때문에,
  // 컬링되면 살짝 패닝했다는 이유로 카드가 사라지고 복원 URL에서 identity가 빠진다.
  keepIds?: Set<string> | null
): { clusters: PixelCluster<T>[]; nudges: Map<string, Nudge>; visibleCount: number } {
  const points: { marker: T; x: number; y: number }[] = [];
  for (const m of markers) {
    const p = projection.containerPointFromCoords(new window.kakao.maps.LatLng(m.lat, m.lng));
    if (viewport && !keepIds?.has(m.id)) {
      // 화면(+여유분) 밖이면 아예 후보에서 뺀다 — 안 보이는 DOM을 만들지 않는다.
      if (p.x < -viewport.margin || p.x > viewport.width + viewport.margin) continue;
      if (p.y < -viewport.margin || p.y > viewport.height + viewport.margin) continue;
    }
    points.push({ marker: m, x: p.x, y: p.y });
  }
  const visibleCount = points.length;

  const used = new Array(points.length).fill(false);
  const clusters: PixelCluster<T>[] = [];
  const nudges = new Map<string, Nudge>();

  points.forEach((p, i) => {
    if (used[i]) return;
    const group = [p];
    used[i] = true;
    points.forEach((q, j) => {
      if (used[j] || i === j) return;
      if (Math.hypot(p.x - q.x, p.y - q.y) <= layout.clusterRadius) {
        group.push(q);
        used[j] = true;
      }
    });
    const avgLat = group.reduce((s, g) => s + g.marker.lat, 0) / group.length;
    const avgLng = group.reduce((s, g) => s + g.marker.lng, 0) / group.length;
    const avgX = group.reduce((s, g) => s + g.x, 0) / group.length;
    const avgY = group.reduce((s, g) => s + g.y, 0) / group.length;
    const clusterId = group.map((g) => g.marker.id).join(',');
    clusters.push({ id: clusterId, lat: avgLat, lng: avgLng, markers: group.map((g) => g.marker) });
    nudges.set(
      clusterId,
      computeSafeZoneNudge({ x: avgX, y: avgY }, layout.width / 2, layout.height / 2, safeZone.top, safeZone.right)
    );
  });

  return { clusters, nudges, visibleCount };
}

// MAP_UX_V2 §7/§8 — 오피스텔 묶음 배지. 두 쓰임이 있다:
//  - 화면에서 겹친 여러 좌표(확대로 풀림)
//  - 같은 좌표의 여러 master(확대로 풀리지 않음 → 목록으로 풂, `stacked`)
// 어느 쪽도 특정 건물을 대표하지 않는다. 개수만 말하고 선택은 사용자가 한다.
// 모듈 레벨 컴포넌트로 둔 이유: 렌더 도중 호출되는 헬퍼 함수에 콜백을 인자로 넘기면
// 그 콜백이 ref(mapRef)를 읽는다는 이유로 react-hooks/refs 규칙에 걸린다. JSX 컴포넌트의
// prop으로 넘기는 것은 정상적인 이벤트 핸들러 전달이다.
function OfficetelGroupBadge({
  count,
  label,
  offset,
  onActivate,
  stacked = false,
}: {
  count: number;
  label: string;
  offset: { dx: number; dy: number };
  onActivate: () => void;
  stacked?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      className={mapMarkerStyles.markerChip}
      style={{
        transform: `translate(${offset.dx}px, ${offset.dy}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        padding: '4px 9px 4px 6px',
        borderRadius: '999px',
        background: 'white',
        border: `2px solid ${OFFI.line}`,
        // 같은 좌표에 쌓인 그룹은 겹쳐진 카드처럼 보이게 해서, 확대하면 풀리는 클러스터와
        // 시각적으로 구분한다(색만으로 구분하지 않는다).
        boxShadow: stacked
          ? `2px 2px 0 -1px white, 3px 3px 0 -1px ${OFFI.line}, 0 2px 5px rgba(0,0,0,0.12)`
          : '0 2px 5px rgba(0,0,0,0.12)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <Building2 size={13} color={OFFI.line} strokeWidth={2.5} aria-hidden="true" />
      <span style={{ fontSize: '0.72rem', fontWeight: 800, color: OFFI.line }}>{count}</span>
    </div>
  );
}

export default function FullscreenMapPage() {
  const router = useRouter();

  const [aptMarkers, setAptMarkers] = useState<AptMarker[]>([]);
  const [aptClusters, setAptClusters] = useState<AptCluster[]>([]);
  // PERCEIVED_PERFORMANCE_V2_3 §1 — 클러스터 확정 시각. 오버레이 커밋(React render +
  // kakao CustomOverlay 생성/부착)이 끝난 뒤 이 값과의 차이를 렌더 비용으로 기록한다.
  const aptCommitStartRef = useRef(0);
  const [schoolMarkers, setSchoolMarkers] = useState<SchoolMarker[]>([]);
  // OFFICETEL_MAP_LAYER_V1 — 오피스텔 레이어. 아파트 state를 재사용하지 않고 완전히
  // 분리한다(§23: 아파트 마커/식별자/카드가 이 STEP으로 인해 달라지면 안 된다).
  const [officetelMarkers, setOfficetelMarkers] = useState<OfficetelMapMarker[]>([]);
  const [officetelClusters, setOfficetelClusters] = useState<PixelCluster<OfficetelCoordGroup>[]>([]);
  // 클러스터가 **어느 마커 목록으로부터** 계산됐는지. 데이터가 막 도착한 프레임에서
  // (클러스터 재계산은 커밋 후 effect에서 일어난다) "표시할 오피스텔이 없습니다"가
  // 한 프레임 번쩍이는 것을 막는다 — 아직 계산 전인 상태와 진짜 0건을 구분한다.
  const [officetelClusteredFrom, setOfficetelClusteredFrom] = useState<OfficetelMapMarker[] | null>(null);
  // §14 — FAILED와 ZERO를 절대 같은 상태로 접지 않는다. 'error'는 "오피스텔이 없다"가 아니다.
  const [officetelStatus, setOfficetelStatus] = useState<OfficetelLayerStatus>('idle');
  const [officetelExcluded, setOfficetelExcluded] = useState(0);
  // 현재 뷰포트 안에 있었으나 렌더 상한(§19)에 걸려 그리지 못한 수 — 말없이 자르지 않는다.
  const [officetelHiddenByCap, setOfficetelHiddenByCap] = useState(0);
  const [selectedOfficetelId, setSelectedOfficetelId] = useState<string | null>(null);
  const [hoveredOfficetelId, setHoveredOfficetelId] = useState<string | null>(null);
  // MAP_UX_V2 §12 — 검색으로 고른 오피스텔의 **정확한 master id**. 마커가 도착하면 이
  // id와 정확히 일치하는 것만 선택한다(이름/근접 좌표/첫 마커 금지). 못 찾으면 조용히
  // 포기한다 — 다른 오피스텔을 대신 선택하지 않는다.
  const [pendingOfficetelId, setPendingOfficetelId] = useState<number | null>(null);
  // §8 — 같은 좌표를 공유하는 master들을 눌렀을 때 뜨는 선택 목록(표시 전용 그룹).
  const [officetelGroupList, setOfficetelGroupList] = useState<OfficetelMapMarker[] | null>(null);
  // 좌표가 없어 지도로 데려갈 수 없는 검색 결과를 고른 경우의 안내.
  const [officetelHandoffNotice, setOfficetelHandoffNotice] = useState<string | null>(null);
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

  // PERCEIVED_PERFORMANCE_V2_3 §3/§7 — recomputeClusters는 지도의 native 'idle' 리스너로
  // 등록되는데, 그 리스너를 activeMarkerId가 바뀔 때마다 다시 걸면 마커를 고르거나
  // hover할 때마다 전체 클러스터 재계산 + 오버레이 재생성이 일어난다(§7 재빌드 금지).
  // 그래서 deps에는 넣지 않고 ref로만 최신 값을 읽는다 — 컬링 면제(keepIds) 판단이
  // 패닝 이후에도 stale closure의 옛 값을 쓰지 않게 하기 위함이다.
  const activeMarkerIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeMarkerIdRef.current = activeMarkerId;
  }, [activeMarkerId]);

  // OFFICETEL_MAP_LAYER_V1 §8 — 오피스텔도 hover(선점) / click(고정)을 같은 규칙으로
  // 나눈다. 카드에 쓸 마커는 클러스터가 아니라 **원본 마커 목록**에서 찾는다 — 클러스터는
  // 뷰포트 컬링 대상이라, 살짝 패닝했다고 선택해둔 카드가 사라지면 안 되기 때문이다.
  const activeOfficetelId = selectedOfficetelId ?? hoveredOfficetelId;
  const selectedOfficetel = useMemo(
    () => (activeOfficetelId ? officetelMarkers.find((m) => m.id === activeOfficetelId) ?? null : null),
    [activeOfficetelId, officetelMarkers]
  );

  // MAP_UX_V2 §12/§14 — 검색 핸드오프의 마지막 단계. 마커가 실제로 도착한 뒤
  // (officetelStatus === 'ready') **정확히 일치하는 id**를 한 번만 찾는다. 로딩 중에
  // 판단하면 아직 비어 있는 배열을 "못 찾음"으로 오판한다. 못 찾으면 다른 마커로
  // 대체하지 않고 그대로 포기한다.
  useEffect(() => {
    if (pendingOfficetelId == null) return;
    if (officetelStatus === 'loading') return;
    if (officetelStatus === 'ready') {
      const match = findExactOfficetelMarker(officetelMarkers, pendingOfficetelId);
      if (match) setSelectedOfficetelId(match.id);
    }
    setPendingOfficetelId(null);
  }, [pendingOfficetelId, officetelStatus, officetelMarkers]);

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
  // TRANSACTIONS_API_TRUST_V1 §7 — 부분 실패 여부를 markers와 **같이** 캐시한다.
  // 플래그를 빼고 markers만 캐시하면 60초 안의 캐시 히트에서 불완전한 결과가 완전한
  // 결과로 되살아난다(PARTIAL이 COMPLETE로 둔갑하는 정확히 그 경로).
  const markerCacheRef = useRef<Map<string, { markers: AptMarker[]; partial: boolean; ts: number }>>(new Map());
  const MARKER_CACHE_TTL_MS = 60_000;
  // 오피스텔도 같은 관례(순번 + exact-key TTL 캐시)를 각자 별도로 갖는다 — 두 레이어의
  // 응답이 서로의 stale 판정을 오염시키지 않게 하기 위해 ref를 공유하지 않는다.
  const officetelSeqRef = useRef(0);
  const officetelCacheRef = useRef<
    Map<string, { markers: OfficetelMapMarker[]; excluded: number; ts: number }>
  >(new Map());
  // 실제로 확정된 lawdCd(역지오코딩 결과 또는 검색/공유가 알려준 값). 초기 추정값
  // ('26140')과 구분해야, 레이어를 켤 때 엉뚱한 구의 오피스텔을 불러오지 않는다.
  const resolvedLawdCdRef = useRef<string | null>(readInitialMapStateFromUrl()?.lawdCd ?? null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  // MAP_LAYER_TOGGLE_V1 §13 — 아파트도 오피스텔과 같은 3상태를 갖는다. 예전에는 실패를
  // console.error로만 삼켜서, 조회 실패와 "이 범위에 아파트가 없음"이 화면에서 구분되지
  // 않았다(FAILED != EMPTY). 혼합 모드에서 한쪽만 실패하는 경우가 생기며 더 중요해졌다.
  const [aptStatus, setAptStatus] = useState<OfficetelLayerStatus>('idle');
  // TRANSACTIONS_API_TRUST_V1 — 일부 기간을 못 읽었으면 마커가 실제보다 적을 수 있다.
  // OfficetelLayerStatus는 오피스텔 지도 계약과 공유하는 타입이라 건드리지 않고,
  // 아파트 레이어 전용 플래그를 따로 둔다.
  const [aptPartial, setAptPartial] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);

  // PERCEIVED_PERFORMANCE_V2_5 §1 — 이 컴포넌트가 실제로 mount된 시점 = 이 라우트의
  // hydration이 끝난 시점. 모듈 평가(map:module-eval)와의 차이가 React hydration 비용이다.
  useEffect(() => {
    perfLog("map:mounted", { t: perfNow() });
  }, []);
  const [mapInstanceReady, setMapInstanceReady] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [center, setCenter] = useState(() => readInitialMapStateFromUrl()?.center ?? DEFAULT_MAP_CENTER); // 기본: 부산광역시 서구(DEFAULT_LAWD_CD와 짝)
  // MAP MARKER UX V2 §21~24 — 공유 링크(lat/lng가 URL에 있음)로 들어왔을 때만 그
  // lawdCd를 기억해둔다. 최초 마커 로드가 이 값을 모르면(일반 진입) 기존과 동일하게
  // center 좌표를 역지오코딩해 lawdCd를 알아낸다 — 그런데 공유 링크로 들어왔을 때도
  // 이 knownLawdCd를 안 넘기면, 역지오코딩 결과가 원래 공유했던 lawdCd와 정확히
  // 일치하지 않을 수 있어(행정구역 경계 근처 좌표 등) 공유된 아파트가 그 결과에
  // 아예 없는 지역으로 잘못 조회될 수 있다 — selected identity 복원(matchRestoreIdentity)
  // 이 애초에 매칭될 기회조차 갖지 못하는 문제로 이어진다.
  const initialShareLawdCdRef = useRef(readInitialMapStateFromUrl()?.lawdCd ?? null);
  // PERCEIVED_PERFORMANCE_V2_1 §1 — URL에 layers가 있으면(= back으로 돌아온 경우나
  // 레이어까지 담은 링크) 그 상태로 복원한다. 없으면 기존 기본값 그대로다.
  // 알 수 없는 키는 무시한다(구/신 배포가 섞여도 안전).
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(() => {
    const base: Record<LayerKey, boolean> = {
      apt: true,
      officetel: false,
      livingLodging: false,
      redevelopment: false,
      auction: false,
      school: false,
    };
    const restored = readInitialMapStateFromUrl()?.layers;
    if (!restored) return base;
    const next = { ...base };
    for (const key of Object.keys(next) as LayerKey[]) next[key] = restored.includes(key);
    return next;
  });
  // ── PERCEIVED_PERFORMANCE_V2_1 §1 — 지도 view 상태를 URL에 동기화한다 ──────────
  //
  // 근본 원인(실측): 지도 -> 마커 -> 상세 -> back 하면 지도가 사용자가 보던 곳이 아니라
  // 기본 지역(26140/서구)으로 돌아갔다. 복원 장치가 없어서가 아니다 —
  // readInitialMapStateFromUrl/parseMapStateFromSearchParams/matchRestoreIdentity가
  // 이미 있었고 잘 동작한다. 문제는 **아무도 현재 상태를 URL에 쓰지 않았다**는 것이다.
  // 이 파라미터들은 지금까지 공유 버튼으로만 만들어졌으므로, back으로 돌아오면 쿼리가
  // 비어 있고 useState 초기값(기본 지역)이 그대로 쓰였다.
  //
  // 그래서 새 상태 저장소를 만들지 않고, 이미 있는 URL 계약에 현재 상태를 계속 반영한다.
  //  - replaceState를 쓴다(pushState 아님) — 패닝할 때마다 history 항목이 쌓이면
  //    사용자가 back을 여러 번 눌러야 지도를 빠져나가게 된다.
  //  - 400ms 디바운스 — 드래그/줌 중에 매 프레임 쓰지 않는다.
  //  - isMapReady 전에는 쓰지 않는다 — 공유 링크로 들어온 파라미터를 우리 기본값으로
  //    덮어쓰면 안 된다(복원이 적용된 뒤부터 쓴다).
  //  - 선택 단지는 **고정 선택(selectedMarkerId)만** 싣는다. hover까지 반영하면 마우스가
  //    지나가기만 해도 URL이 바뀐다.
  //  - identity는 buildMapRestoreParams가 buildMapShareParams를 그대로 쓰므로
  //    aptSeq 우선 / name-only 금지 규칙이 그대로 강제된다.
  const pinnedMarker = useMemo(
    () => resolveSelectedMarker(selectedMarkerId, aptClusters, pendingSelectedApt),
    [selectedMarkerId, aptClusters, pendingSelectedApt]
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !isMapReady) return;
    const timer = window.setTimeout(() => {
      const qs = mapParamsToQueryString(
        buildMapRestoreParams(center, zoomLevel, currentLawdCd, pinnedMarker, layers)
      );
      const next = `${window.location.pathname}?${qs}`;
      if (next === window.location.pathname + window.location.search) return;
      // history.state를 그대로 넘겨 Next.js router의 내부 상태를 깨뜨리지 않는다.
      window.history.replaceState(window.history.state, '', next);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [isMapReady, center, zoomLevel, currentLawdCd, layers, pinnedMarker]);

  const isDetailed = zoomLevel <= DETAIL_ZOOM_LEVEL;
  // MAP_UX_V2 §6/§9 — 확대 단계별 밀도. 두 레이어가 **같은 규칙**(map-property-focus)을
  // 쓴다: 레벨 3 이하만 낱개 마커, 그보다 축소되면 묶음 마커 하나로 그린다. V1에서
  // 아파트는 축소해도 개별 가격 칩을 전부 그려서, 부산진구 서면 360px 실측 기준 마커가
  // 화면의 80%를 덮었다.
  // MAP_LAYER_TOGGLE_V1 §6 — 두 종류가 동시에 켜져 있으면 화면을 나눠 쓰므로 오피스텔
  // 밀도 예산을 한 단계 조인다. 단독 모드의 동작은 그대로다.
  const mixedMode = isMixedPropertyMode(layers);
  const aptDensity = markerDensityMode('apt', zoomLevel, mixedMode);
  const officetelDensity = markerDensityMode('officetel', zoomLevel, mixedMode);
  const isOfficetelDetailed = officetelDensity === 'individual';
  // "낱개로 그린다"와 "이름을 쓴다"는 다른 결정이다(실측: 레벨 3에서 낱개 63개는
  // 감당되지만 이름표를 붙이면 화면의 71%를 덮는다). 이름은 한 단계 더 확대해야 나온다.
  const officetelNamed = showsOfficetelName(zoomLevel, mixedMode);
  // §8 — 혼합 모드에서 아파트/오피스텔 마커가 같은 지점에 겹치지 않도록 오피스텔
  // 오버레이만 화면에서 조금 내린다(좌표·식별자·클릭 대상은 그대로).
  const officetelOverlapDy = mixedOverlapOffsetY(mixedMode);
  const chipLayout = aptDensity === 'individual'
    ? (isDetailed ? CHIP_LAYOUT.detailed : CHIP_LAYOUT.compact)
    : APT_GROUP_CHIP;
  const officetelChipLayout = officetelNamed ? OFFICETEL_CHIP_LAYOUT.detailed : OFFICETEL_CHIP_LAYOUT.compact;
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
  const [officetelNudges, setOfficetelNudges] = useState<Map<string, Nudge>>(new Map());

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

  // PERCEIVED_PERFORMANCE_V2 §5 — SDK 준비 판정을 공용 로더(src/lib/kakao/maps-sdk.ts)
  // 하나로 모은다.
  //
  // 예전 구현은 이 파일에서 스크립트를 직접 주입하고 `setInterval(…, 200)`으로 준비
  // 여부를 폴링했다. 폴링은 "준비된 시점"과 "감지한 시점" 사이에 평균 100ms·최악
  // 200ms의 고정 지연을 만드는데, 그 지연이 뒤따르는 전 과정(역지오코딩 → 마커 조회 →
  // 클러스터 계산)을 통째로 뒤로 민다. 공용 로더는 스크립트 `load` 이벤트로 정확한
  // 시점에 resolve하며, 프로미스를 캐시하므로 상세→지도→로드뷰처럼 오가는 경로에서
  // SDK를 다시 기다리지 않는다(중복 초기화도 구조적으로 불가능해진다).
  //
  // 실패 문구는 기존 것을 그대로 유지한다 — 광고차단/사내망으로 dapi.kakao.com이
  // 막히는 실제 사례를 사용자에게 계속 정확히 알려야 한다(무한 로더 금지).
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    loadKakaoMapsSdk()
      .then(() => {
        if (cancelled) return;
        perfLog("map:sdk-ready", { t: perfNow() });
        setIsMapReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        const code = err instanceof Error ? err.message : String(err);
        setMapLoadError(
          code === 'KAKAO_SDK_SCRIPT_ERROR'
            ? '카카오맵 스크립트를 불러오지 못했습니다. 광고 차단 확장 프로그램이나 네트워크(사내망/통신사) 설정이 dapi.kakao.com 접속을 막고 있을 수 있습니다.'
            : '지도를 불러오는 데 시간이 너무 오래 걸립니다. 네트워크 상태를 확인하거나 광고 차단 확장 프로그램을 꺼보세요.'
        );
      });

    return () => {
      cancelled = true;
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
  // OFFICETEL_MAP_LAYER_V1 §5 — 좌표 → lawdCd 역지오코딩을 한 곳으로 모은다. 예전에는
  // 이 로직이 fetchAptMarkers 안에만 있어서 다른 레이어가 lawdCd를 알 방법이 없었다.
  // 동작(성공 시 region_type 'B', 실패 시 부산 서구 폴백)은 그대로다 — 아파트 경로의
  // 결과가 달라지지 않는다(§23). 두 레이어가 동시에 켜져 있어도 왕복은 1회다.
  const DEFAULT_FALLBACK_LAWD_CD = '26140'; // 부산광역시 서구
  const resolveLawdCd = (lat: number, lng: number): Promise<string | null> =>
    new Promise((resolve) => {
      if (!window.kakao?.maps?.services) {
        resolve(null);
        return;
      }
      const geocoder = new window.kakao.maps.services.Geocoder();
      geocoder.coord2RegionCode(lng, lat, (result: any, status: any) => {
        // 사용자의 실제 GPS 좌표가 국내 행정구역으로 역지오코딩되지 않는 경우(해외, 또는
        // 카카오가 지원하지 않는 좌표)가 실제로 있다 — 이때 그냥 포기해버리면
        // isLoadingData가 영원히 true로 남아 페이지 전체가 "지도 데이터를 불러오는
        // 중입니다..."에 멈춘 것처럼 보이는 심각한 버그였다(발견: 실사용자 리포트로 좌표
        // 실패 케이스를 재현). 역지오코딩이 실패하면 이 서비스의 기본 대상 지역(부산 서구)
        // 데이터로 폴백해서 최소한 화면에 뭔가는 뜨게 한다.
        const region =
          status === window.kakao.maps.services.Status.OK
            ? result.find((r: any) => r.region_type === 'B')
            : null;
        resolve(region ? region.code.substring(0, 5) : DEFAULT_FALLBACK_LAWD_CD);
      });
    });

  // PERCEIVED_PERFORMANCE_V2_2 §3 — 마커 응답 **원시 payload**만 미리 받아두는 캐시.
  // 상태를 전혀 건드리지 않으므로 렌더 순서에 영향이 없고, 실제 조회 시점에 이 프로미스를
  // 그대로 재사용해 네트워크 왕복을 앞당긴다. 실패는 여기서 삼키지 않고 그대로 넘겨
  // 기존 실패 처리(FAILED != EMPTY)가 판단하게 한다.
  const aptPrefetchRef = useRef<Map<string, Promise<{ ok: boolean; body: unknown }>>>(new Map());
  const prefetchAptPayload = (lawdCd: string): Promise<{ ok: boolean; body: unknown }> => {
    const hit = aptPrefetchRef.current.get(lawdCd);
    if (hit) return hit;
    // PERCEIVED_PERFORMANCE_V2_4 §1 — map/layout.tsx의 부트 스크립트가 hydration 이전에
    // 이미 같은 요청을 걸어뒀으면 그 promise를 그대로 쓴다. 같은 lawdCd일 때만 받는다
    // (다른 구를 보고 있는데 부트 때 받아둔 기본 지역 응답을 쓰면 **다른 구의 마커를
    // 보여주게 된다** — 절대 금지). 한 번 쓰고 나면 지우고, 이후 갱신은 평소 경로를 탄다.
    const boot = typeof window !== 'undefined' ? window.__EJIP_APT_BOOT__ : undefined;
    const p = boot && boot.lawdCd === lawdCd
      ? boot.promise
      : fetch(aptMarkerRequestPath(lawdCd))
          .then(async (r) => ({ ok: r.ok, body: r.ok ? await r.json() : null }))
          .catch(() => ({ ok: false, body: null }));
    if (boot && boot.lawdCd === lawdCd && typeof window !== 'undefined') {
      delete window.__EJIP_APT_BOOT__;
    }
    aptPrefetchRef.current.set(lawdCd, p);
    // 오래된 응답을 재사용하지 않도록 짧게만 붙잡는다(지역 재방문은 markerCacheRef가 담당).
    setTimeout(() => aptPrefetchRef.current.delete(lawdCd), 15000);
    return p;
  };

  const fetchAptMarkers = async (lat: number, lng: number, knownLawdCd?: string) => {
    const loadForLawdCd = async (lawdCd: string) => {
      setCurrentLawdCd(lawdCd);
      resolvedLawdCdRef.current = lawdCd;
      const mySeq = ++requestSeqRef.current;

      // exact-key 캐시 히트 — 같은 lawdCd로 짧은 시간 안에 재진입하면 네트워크 요청 없이
      // 즉시 반영한다(예: 드래그로 벗어났다 다시 돌아오는 경우).
      const cached = markerCacheRef.current.get(lawdCd);
      if (cached && isMarkerCacheFresh(cached.ts, Date.now(), MARKER_CACHE_TTL_MS)) {
        setAptMarkers(cached.markers);
        setAptPartial(cached.partial);
        setIsLoadingData(false);
        setAptStatus('ready');
        perfMeasure('map: click→surrounding markers ready', 'map:m0-click');
        return;
      }

      try {
        // 실거래 마커 데이터와 "최근 24시간 내 커뮤니티 글이 있는 단지" 집계는 서로
        // 무관한 조회라 Promise.all로 병렬 처리한다.
        const [payload, activityRes] = await Promise.all([
          // PERCEIVED_PERFORMANCE_V2_DATAFLOW §8 — fields=marker는 이 페이지의 dedup
          // 규칙(좌표 없음/취소 건 제외 후 단지별 최신 1건)을 서버에서 그대로 재현한
          // 슬림 응답이다. 아래 dedup 루프는 그대로 두어 계약이 바뀌어도(구 배포 응답이
          // 섞여도) 결과가 같도록 한다 — 이미 걸러진 목록에 같은 필터를 다시 적용해도
          // 결과는 동일하다(멱등).
          // PERCEIVED_PERFORMANCE_V2_2 §3 — 마운트 때 이미 쏴둔 요청이 있으면 그 프로미스를
          // 그대로 쓴다(같은 URL을 두 번 받지 않는다).
          prefetchAptPayload(lawdCd),
          fetch(`/api/community/recent-activity`).catch(() => null),
        ]);
        // TRANSACTIONS_API_TRUST_V1 — 공유 리더로 실패/부분 실패/검증된 0건을 구분한다.
        // (배열 응답도 그대로 받아들이므로 배포 중 버전이 어긋나도 깨지지 않는다.)
        const txState = resolveTransactionsReadState<any>(payload.ok, payload.body);
        if (txState.apiError) throw new Error('apt markers payload invalid');
        const data = txState.trades;
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

        markerCacheRef.current.set(lawdCd, { markers, partial: txState.partial, ts: Date.now() });
        setAptMarkers(markers);
        setAptPartial(txState.partial);
        setAptStatus('ready');
        // §12 M6 — 주변 마커 전체 dataset 준비 완료(M0 클릭 흐름에서 호출된 경우에만
        // 의미 있음 — 드래그/현재위치 등 다른 호출부에서도 공유되는 mark라 클릭 흐름이
        // 아닐 때는 이 measure가 실패해도(시작 mark 없음) 무해하게 무시된다).
        perfMeasure('map: click→surrounding markers ready', 'map:m0-click');
      } catch (error) {
        console.error('Failed to fetch apt markers:', error);
        // §13 FAILED != EMPTY — 실패를 빈 목록으로 위장하지 않는다. 이전 지역의 마커를
        // 남겨두지도 않는다(§11 stale marker leakage 금지).
        if (isStaleMarkerResponse(mySeq, requestSeqRef.current)) return;
        setAptMarkers([]);
        setAptStatus('error');
      } finally {
        if (!isStaleMarkerResponse(mySeq, requestSeqRef.current)) setIsLoadingData(false);
      }
    };

    if (knownLawdCd) {
      await loadForLawdCd(knownLawdCd);
      return;
    }

    const lawdCd = await resolveLawdCd(lat, lng);
    if (!lawdCd) {
      setIsLoadingData(false);
      setAptStatus('error');
      return;
    }
    await loadForLawdCd(lawdCd);
  };

  // OFFICETEL_MAP_LAYER_V1 §3/§4 — 오피스텔 마커는 `officetel_masters`에 **이미 저장된**
  // 좌표만 쓴다. 이 함수는 카카오 지오코딩/장소검색을 한 번도 호출하지 않는다(§20).
  // 좌표가 없는 master(부산 전체 8건)는 서버가 응답에서 제외하고 그 수를 함께 알려준다.
  const fetchOfficetelMarkers = async (lawdCd: string) => {
    const mySeq = ++officetelSeqRef.current;
    setOfficetelStatus('loading');

    const cached = officetelCacheRef.current.get(lawdCd);
    if (cached && isMarkerCacheFresh(cached.ts, Date.now(), MARKER_CACHE_TTL_MS)) {
      setOfficetelMarkers(cached.markers);
      setOfficetelExcluded(cached.excluded);
      setOfficetelStatus('ready');
      return;
    }

    try {
      const res = await fetch(`/api/officetel/markers?lawdCd=${encodeURIComponent(lawdCd)}`);
      // §14 FAILED != ZERO — 실패를 빈 배열로 바꿔 "오피스텔이 없습니다"로 보이게 하지 않는다.
      if (!res.ok) throw new Error(`officetel markers HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.success || !Array.isArray(json?.data?.markers)) throw new Error('officetel markers payload invalid');
      // 레이어를 빠르게 껐다 켜거나 지역을 연속으로 옮기면 먼저 보낸 요청이 늦게 도착할 수
      // 있다 — 자신이 여전히 최신 요청일 때만 화면에 반영한다(아파트 레이어와 같은 관례).
      if (isStaleMarkerResponse(mySeq, officetelSeqRef.current)) return;

      const markers = json.data.markers as OfficetelMapMarker[];
      const excluded = typeof json.data.excludedNoCoordinate === 'number' ? json.data.excludedNoCoordinate : 0;
      officetelCacheRef.current.set(lawdCd, { markers, excluded, ts: Date.now() });
      setOfficetelMarkers(markers);
      setOfficetelExcluded(excluded);
      setOfficetelStatus('ready');
    } catch (error) {
      console.error('Failed to fetch officetel markers:', error);
      if (isStaleMarkerResponse(mySeq, officetelSeqRef.current)) return;
      // 실패했으면 이전 지역의 마커를 그대로 남겨두지 않는다(§15 stale marker leakage 금지).
      setOfficetelMarkers([]);
      setOfficetelExcluded(0);
      setOfficetelStatus('error');
    }
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

  // lawdCd가 필요한 레이어(아파트/오피스텔)가 여러 개 켜져 있어도 역지오코딩은 한 번만
  // 한다 — 같은 좌표로 두 번 왕복하면 §19 성능 목표를 스스로 깎는다.
  // MAP_LAYER_TOGGLE_V1 §2/§19 — 어느 매물 레이어를 새로 고칠지 명시적으로 받는다.
  // 기본값은 현재 layers지만, 검색 핸드오프처럼 **같은 커밋 안에서 레이어를 막 켠**
  // 호출부는 아직 갱신되지 않은 layers 클로저를 읽으면 안 되므로 원하는 값을 직접
  // 넘긴다(stale closure로 엉뚱한 레이어를 조회하는 것을 구조적으로 막는다).
  // 꺼져 있는 종류는 조회하지 않는다 — pan/zoom마다 불필요한 요청을 내지 않는다(§19).
  const refreshActiveLayers = async (
    lat: number,
    lng: number,
    knownLawdCd?: string,
    want: { apt: boolean; officetel: boolean } = { apt: layers.apt, officetel: layers.officetel }
  ) => {
    if (layers.school) fetchSchoolMarkers(lat, lng);
    // 꺼진 레이어의 로딩 표시를 켜둔 채 두지 않는다.
    if (!want.apt) {
      setIsLoadingData(false);
      setAptStatus('idle');
    }
    if (want.apt) setAptStatus('loading');
    if (want.officetel) setOfficetelStatus('loading'); // 즉시 시각 피드백(§12)
    // §14 — 두 종류가 모두 꺼져 있으면 지역 조회조차 하지 않는다(기본 지도만).
    if (!want.apt && !want.officetel) return;

    const lawdCd = knownLawdCd ?? (await resolveLawdCd(lat, lng));
    if (!lawdCd) {
      setIsLoadingData(false);
      if (want.apt) setAptStatus('error');
      if (want.officetel) setOfficetelStatus('error');
      return;
    }
    resolvedLawdCdRef.current = lawdCd;
    // 아파트 레이어가 꺼져 있어도 현재 지역은 알고 있어야 한다(학교 링크/공유 파라미터).
    setCurrentLawdCd(lawdCd);
    // §13 — 두 조회는 서로 독립이다. 한쪽이 실패해도 다른 쪽은 그대로 쓸 수 있다.
    if (want.apt) fetchAptMarkers(lat, lng, lawdCd);
    if (want.officetel) fetchOfficetelMarkers(lawdCd);
  };

  // aptMarkers를 현재 지도 줌/중심 기준 화면 픽셀 좌표로 투영해서 서로 가까운 칩끼리
  // 묶는다. 실제 kakao.maps.Map 인스턴스의 projection API가 필요해서(react-kakao-maps-sdk
  // 프롭이 아니라 원본 SDK 기능) mapRef를 직접 사용한다.
  const recomputeClusters = () => {
    const map = mapRef.current;
    if (!map || !window.kakao?.maps) {
      setAptClusters([]);
      setOfficetelClusters([]);
      return;
    }
    const projection = map.getProjection();
    if (!projection) return;

    // 두 레이어가 같은 뷰포트 rect를 쓰므로 한 번만 잰다(layout read 1회).
    const rect = mapViewportRef.current?.getBoundingClientRect();
    const aptViewport = rect
      ? { width: rect.width, height: rect.height, margin: APT_VIEWPORT_MARGIN_PX }
      : null;

    // ── 아파트(§3 뷰포트 컬링) ────────────────────────────────────────────────
    if (aptMarkers.length === 0) {
      setAptClusters([]);
      setClusterNudges(new Map());
    } else {
      const t0 = perfNow();
      // 선택/고정된 마커는 화면 밖이어도 남긴다(위 keepIds 주석 참고). hover는 보이는
      // 마커에서만 생기므로 activeMarkerId 하나로 두 경우가 모두 덮인다.
      const activeId = activeMarkerIdRef.current;
      const keepIds = activeId ? new Set([activeId]) : null;
      const apt = clusterMarkersByPixels(projection, aptMarkers, chipLayout, safeZoneRects, aptViewport, keepIds);
      const t1 = perfNow();
      // §1 — 오버레이 커밋 비용을 재기 위해 "클러스터가 정해진 시각"을 남긴다.
      aptCommitStartRef.current = t1;
      perfLog('map:cluster:apt', {
        markers: aptMarkers.length,
        clusters: apt.clusters.length,
        visible: apt.visibleCount,
        ms: t1 - t0,
      });
      setAptClusters(apt.clusters);
      setClusterNudges(apt.nudges);
    }

    // ── 오피스텔(뷰포트 컬링 + 렌더 상한) ────────────────────────────────────
    setOfficetelClusteredFrom(officetelMarkers);
    if (officetelMarkers.length === 0 || zoomLevel > OFFICETEL_MAX_ZOOM_LEVEL) {
      setOfficetelClusters([]);
      setOfficetelNudges(new Map());
      setOfficetelHiddenByCap(0);
    } else {
      // MAP_UX_V2 §8 — 픽셀 클러스터링 **이전에** 좌표가 완전히 같은 master들을 하나의
      // 표시 그룹으로 접는다. 확대해도 절대 갈라지지 않는 겹침을 부채꼴로 펼쳐봐야
      // 서로를 가릴 뿐이다. 그룹은 표시 단위일 뿐이고 멤버는 각자의 identity를 유지한다.
      const coordGroups = groupByExactCoordinate(officetelMarkers);
      const offi = clusterMarkersByPixels(
        projection,
        coordGroups,
        officetelChipLayout,
        safeZoneRects,
        rect
          ? { width: rect.width, height: rect.height, margin: OFFICETEL_VIEWPORT_MARGIN_PX }
          : null
      );
      // §19 — 상한을 넘으면 앞에서부터 잘라 그리되, 못 그린 수를 화면에 알린다(silent 금지).
      // 상한은 실제로 만들어지는 오버레이 수를 기준으로 센다: 축소 상태에서는 묶음
      // 배지 하나가 오버레이 하나(그룹 안 개수와 무관), 확대 상태에서는 칩 하나가
      // 오버레이 하나다. 화면에 알리는 수는 어느 경우든 "못 본 오피스텔 수"다.
      const mastersIn = (c: PixelCluster<OfficetelCoordGroup>) =>
        c.markers.reduce((s, g) => s + g.members.length, 0);
      let rendered = 0;
      let shownMasters = 0;
      let visibleMasters = 0;
      const capped: PixelCluster<OfficetelCoordGroup>[] = [];
      for (const c of offi.clusters) {
        visibleMasters += mastersIn(c);
        // 확대 상태에서는 좌표 그룹 하나가 오버레이 하나(그룹 자체가 묶음 마커로 그려짐),
        // 축소 상태에서는 픽셀 클러스터 하나가 오버레이 하나다.
        const overlayCost = isOfficetelDetailed ? c.markers.length : 1;
        if (rendered + overlayCost > OFFICETEL_RENDER_CAP) continue;
        capped.push(c);
        rendered += overlayCost;
        shownMasters += mastersIn(c);
      }
      setOfficetelClusters(capped);
      setOfficetelNudges(offi.nudges);
      setOfficetelHiddenByCap(Math.max(0, visibleMasters - shownMasters));
    }
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
  // PERCEIVED_PERFORMANCE_V2_3 §1/§3 — 오버레이 커밋 비용 계측.
  // aptClusters가 바뀐 뒤 이 effect가 도는 시점이면 React render + 모든 CustomOverlayMap의
  // useLayoutEffect(=kakao CustomOverlay 생성/부착)가 이미 끝나 있다. 그래서 여기서 재는
  // 값이 곧 "오버레이 생성 → map attach" 비용이다. PERF_ENABLED가 아니면 아무 일도 하지 않는다.
  useEffect(() => {
    if (!PERF_ENABLED || !aptCommitStartRef.current) return;
    const chips = typeof document !== 'undefined'
      ? document.querySelectorAll('[class*="markerChip"]').length
      : 0;
    perfLog('map:overlay:apt', {
      clusters: aptClusters.length,
      domChips: chips,
      ms: perfNow() - aptCommitStartRef.current,
    });
    aptCommitStartRef.current = 0;
  }, [aptClusters]);

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
  // ── PERCEIVED_PERFORMANCE_V2_2 §3 — 마커 조회를 SDK와 병렬로 시작한다 ────────────
  //
  // 마커 데이터는 **우리 HTTP API**라 Kakao SDK도 지도 인스턴스도 필요 없다. 그런데
  // 아래 초기 로드는 `isMapReady`를 기다렸고, 그 뒤 다시 좌표→lawdCd 역지오코딩
  // (coord2RegionCode, Kakao 왕복)까지 기다렸다. BEFORE 실측(직접 진입, n=4):
  //   SDK ready 1,488ms → coord2RegionCode 2,034~2,146ms → 마커 요청 2,229ms
  //   = SDK ready 이후에만 741ms를 더 기다렸다.
  //
  // URL이 이미 lawdCd를 알려주는 진입(공유 링크 / V2.1 복원)에서는 그 기다림이 전부
  // 불필요하다. 지역을 이미 알고 있으므로 역지오코딩도 필요 없고, 지오로케이션 effect도
  // 이 경우 早期 return하므로(§9-b) center가 나중에 바뀌어 다른 구를 조회하게 될
  // 위험도 구조적으로 없다. 그래서 이 경로만 마운트 즉시 조회를 시작한다.
  //
  // 직접 진입(파라미터 없음)은 **건드리지 않는다** — 그 경로의 지역은 GPS/IP로 정해지는
  // center에 달려 있어서, 일찍 쏘면 지오로케이션이 도착하기 전의 기본 center로 엉뚱한
  // 구를 조회할 수 있다. 속도를 위해 지역 정확도를 흔들지 않는다.
  //
  // 처음엔 여기서 곧바로 fetchAptMarkers()를 호출해 마커를 state에 넣어봤는데, 그게
  // **더 느렸다**(실측: 첫 마커 2,190ms -> 3,254ms). 이유는 네트워크가 아니라 렌더
  // 순서였다 — 지도가 마운트되는 첫 커밋에 이미 마커 데이터가 들어 있으면 지도 인스턴스
  // 생성/타일 로드와 오버레이 렌더가 한 커밋에 겹친다(타일 완료 2,730ms → 첫 마커
  // 3,404ms로 밀림). 그래서 조기 단계에서는 **응답만 받아두고 state는 건드리지 않는다.**
  // 렌더 순서는 예전과 100% 동일하고, 네트워크만 앞당겨진다.
  // PERCEIVED_PERFORMANCE_V2_4 §1 — 이제 요청 자체는 layout.tsx의 부트 스크립트가
  // hydration 이전(약 340ms)에 이미 걸어둔다. 여기서는 그 promise를 prefetch 맵에
  // 등록만 해서, 아래 refreshActiveLayers가 같은 lawdCd로 도달했을 때 새 요청을 내지
  // 않고 그대로 재사용하게 한다. 부트 스크립트가 못 돌았거나(구형 브라우저/차단)
  // 조건이 안 맞았으면 평소대로 여기서 요청이 나간다 — 동작은 같고 시작만 늦어진다.
  useEffect(() => {
    if (hasNoPropertyLayer(layers) || !layers.apt) return;
    const lawdCd = initialShareLawdCdRef.current ?? bootPrefetchLawdCd(window.location.search);
    if (!lawdCd) return;
    prefetchAptPayload(lawdCd);
    // 마운트 1회.
  }, []);

  useEffect(() => {
    if (!isMapReady) return;
    // §14 — 매물 레이어가 하나도 켜져 있지 않으면 로딩 표시도 조회도 하지 않는다.
    if (hasNoPropertyLayer(layers)) return;
    if (layers.apt) setIsLoadingData(true);
    // PERCEIVED_PERFORMANCE_V2_4 §2/§3 — center가 아직 기본값 그대로면 그 지역은
    // 이미 알고 있다(DEFAULT_MAP_CENTER ↔ DEFAULT_LAWD_CD). 그걸 다시 알아내려고
    // Kakao coord2RegionCode를 왕복할 이유가 없다(실측 약 195ms + 서드파티 의존).
    // GPS/IP가 center를 옮겼거나 공유 링크로 들어왔으면 이 분기를 타지 않으므로
    // 기존 역지오코딩 경로가 그대로 유지된다 — 속도 때문에 지역 정확도를 흔들지 않는다.
    const knownLawdCd =
      initialShareLawdCdRef.current ?? (isDefaultMapCenter(center) ? DEFAULT_LAWD_CD : undefined);
    refreshActiveLayers(center.lat, center.lng, knownLawdCd);
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
      perfLog("map:instance-ready", { t: perfNow(), via: "immediate" });
      setMapInstanceReady(true);
      return;
    }
    const checkMapInstance = setInterval(() => {
      if (mapRef.current) {
        clearInterval(checkMapInstance);
        perfLog("map:instance-ready", { t: perfNow(), via: "poll" });
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
  // PERCEIVED_PERFORMANCE_V2_5 §7 — 첫 타일이 실제로 그려진 시점. DOM에서 타일 img를
  // 관찰하는 것보다 정확하다(카카오가 직접 알려준다). 계측이 꺼져 있으면 리스너를 걸지 않는다.
  useEffect(() => {
    if (!PERF_ENABLED || !mapInstanceReady || !mapRef.current || !window.kakao?.maps?.event) return;
    const map = mapRef.current;
    const onTiles = () => perfLog("map:tiles-loaded", { t: perfNow() });
    window.kakao.maps.event.addListener(map, "tilesloaded", onTiles);
    return () => window.kakao.maps.event.removeListener(map, "tilesloaded", onTiles);
  }, [mapInstanceReady]);

  useEffect(() => {
    if (!mapInstanceReady || !mapRef.current || !window.kakao?.maps?.event) return;
    const map = mapRef.current;
    const handleIdle = () => recomputeClusters();
    window.kakao.maps.event.addListener(map, 'idle', handleIdle);
    recomputeClusters();
    return () => {
      window.kakao.maps.event.removeListener(map, 'idle', handleIdle);
    };
    // officetelMarkers도 같은 재계산 대상이다 — 넣지 않으면 오피스텔 데이터가 도착해도
    // 'idle' 이벤트(=사용자가 지도를 움직일 때)가 오기 전까지 마커가 안 그려진다.
  }, [mapInstanceReady, aptMarkers, officetelMarkers, zoomLevel, safeZoneRects]);

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
        // PERCEIVED_PERFORMANCE_V1 §7 — 선택된 마커 하나만 라우트 shell을 미리
        // 받아둔다(전체 마커 무차별 prefetch 아님). 실제 이동은 여전히 2번째
        // 클릭(위 분기)에서만 일어난다.
        router.prefetch(`/apt/${encodeURIComponent(marker.name)}`);
        setSelectedMarkerId(marker.id);
        // 오피스텔 카드가 열려 있었다면 닫는다(두 레이어의 카드가 겹치지 않게).
        setSelectedOfficetelId(null);
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

  // 오피스텔 마커 칩. 아파트 칩과 **색·모양·내용**이 모두 다르다: 아파트는 초록 +
  // 가격/면적(둥근 말풍선), 오피스텔은 **파랑** + 건물 아이콘 + 이름(각진 사각)이며
  // 가격을 표시하지 않는다(지어낸 시세나 마커 장식용 대표가격을 만들지 않는다).
  // MAP_UX_V2 §3 — V1의 teal은 이집 Green과 너무 가까워 모바일에서 종류가 구분되지
  // 않았다. 파랑으로 옮기고, 색 외에도 아이콘/모양/가격 유무로 구분되게 유지한다.
  const renderOfficetelChip = (marker: OfficetelMapMarker, selected: boolean) => {
    const handleClick = () => {
      if (selectedOfficetelId === marker.id) {
        // §9 EXACT DETAIL NAVIGATION — 항상 master id로만 이동한다(이름/주소 재검색 금지).
        router.push(`/officetel/${marker.officetelId}`);
      } else {
        router.prefetch(`/officetel/${marker.officetelId}`);
        setSelectedOfficetelId(marker.id);
        // 두 레이어의 카드가 동시에 뜨지 않도록 아파트 선택은 해제한다.
        setSelectedMarkerId(null);
        setPendingSelectedApt(null);
      }
    };
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    };
    const ariaLabel = `오피스텔 ${marker.displayName}${selected ? ', 선택됨' : ''}`;
    const common = {
      onClick: handleClick,
      onMouseEnter: () => setHoveredOfficetelId(marker.id),
      onMouseLeave: () => setHoveredOfficetelId((cur) => (cur === marker.id ? null : cur)),
      role: 'button' as const,
      tabIndex: 0,
      'aria-pressed': selected,
      'aria-label': ariaLabel,
      onKeyDown: handleKeyDown,
      title: marker.displayName,
    };
    const ring = selected
      ? OFFI.ring
      : '0 2px 5px rgba(0,0,0,0.12)';

    if (!officetelNamed) {
      return (
        <div
          {...common}
          className={mapMarkerStyles.markerChip}
          style={{
            width: 30,
            height: 30,
            borderRadius: '8px',
            background: selected ? OFFI.fill : 'white',
            border: `2px solid ${selected ? OFFI.lineStrong : OFFI.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: ring,
            cursor: 'pointer',
            transform: selected ? 'scale(1.12)' : 'scale(1)',
            transition: 'transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease',
          }}
        >
          <Building2 size={16} color={selected ? 'white' : OFFI.line} strokeWidth={2.5} aria-hidden="true" />
        </div>
      );
    }

    return (
      <div
        {...common}
        className={mapMarkerStyles.markerChip}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          maxWidth: 132,
          padding: '3px 8px 3px 5px',
          borderRadius: '8px',
          background: selected ? OFFI.fill : 'white',
          border: `2px solid ${selected ? OFFI.lineStrong : OFFI.line}`,
          boxShadow: ring,
          cursor: 'pointer',
          transform: selected ? 'scale(1.06)' : 'scale(1)',
          transition: 'transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease',
        }}
      >
        <span
          style={{
            flexShrink: 0,
            width: 18,
            height: 18,
            borderRadius: '5px',
            background: selected ? 'rgba(255,255,255,0.22)' : OFFI.line,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Building2 size={12} color="white" aria-hidden="true" />
        </span>
        <span
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            color: selected ? 'white' : OFFI.line,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {marker.displayName}
        </span>
      </div>
    );
  };

  // 묶음 배지를 눌렀을 때 그 지점을 기준으로 한 단계 확대한다. 데이터를 바꾸지 않고
  // 화면만 확대하므로, 확대 후에는 같은 master들이 낱개 칩으로 펼쳐진다.
  const zoomIntoCluster = (lat: number, lng: number) => {
    const map = mapRef.current;
    if (!map || !window.kakao?.maps) return;
    const anchor = new window.kakao.maps.LatLng(lat, lng);
    const nextLevel = Math.max(1, map.getLevel() - 1);
    map.setLevel(nextLevel, { anchor });
    setZoomLevel(nextLevel);
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

  // OFFICETEL_MAP_LAYER_V1 §15 — 데이터 fetch를 setLayers **업데이터 함수 안에서**
  // 하면 안 된다. React는 업데이터를 순수 함수로 보고 개발 모드(StrictMode)에서 일부러
  // 두 번 호출하기 때문에, 레이어를 한 번 켤 때마다 같은 요청이 두 번 나간다(실측:
  // /api/officetel/markers 가 토글 1회에 4번 호출되고 그중 2건이 DB 커넥션 경합으로
  // 503). 상태 갱신과 부수효과를 분리한다 — 아파트/학교 레이어에도 같은 문제가 있었다.
  // MAP_LAYER_TOGGLE_V1 §2 — 아파트/오피스텔은 학교/재개발과 마찬가지로 **독립 토글**이다.
  // MAP_UX_V2의 배타적 포커스 모드를 걷어냈다: 밀도는 확대 단계 규칙과 묶음 마커로 이미
  // 해결됐고, 배타성까지 유지하면 "둘 다 보고 싶다"는 정당한 요구를 막을 뿐이다.
  // 네 조합이 모두 유효하며, 둘 다 끈 상태(기본 지도만)도 정상이다(§3/§14).

  /** 오피스텔 레이어의 화면 상태를 전부 비운다(끄기/전환 시 공통). */
  const clearOfficetelLayer = () => {
    officetelSeqRef.current += 1; // 진행 중이던 응답 무효화(§11)
    setOfficetelMarkers([]);
    setOfficetelClusters([]);
    setOfficetelClusteredFrom(null);
    setOfficetelStatus('idle');
    setOfficetelExcluded(0);
    setOfficetelHiddenByCap(0);
    setSelectedOfficetelId(null);
    setHoveredOfficetelId(null);
    setOfficetelGroupList(null);
    setPendingOfficetelId(null);
    setOfficetelHandoffNotice(null);
  };

  /** 아파트 레이어의 화면 상태를 전부 비운다. */
  const clearAptLayer = () => {
    requestSeqRef.current += 1; // 진행 중이던 응답 무효화(§11)
    setAptMarkers([]);
    setAptClusters([]);
    setClusterNudges(new Map());
    setAptStatus('idle');
    setIsLoadingData(false);
    setSelectedMarkerId(null);
    setHoveredMarkerId(null);
    setPendingSelectedApt(null);
    setPendingRestoreIdentity(null);
  };

  /** 오피스텔 레이어를 켜고 현재 지역 마커를 채운다(이미 켜져 있으면 조회만). */
  const loadOfficetelForCurrentArea = () => {
    setOfficetelStatus('loading'); // 네트워크보다 먼저 시각 피드백(§12)
    const known = resolvedLawdCdRef.current;
    if (known) {
      fetchOfficetelMarkers(known);
      return;
    }
    resolveLawdCd(center.lat, center.lng).then((lawdCd) => {
      if (!lawdCd) {
        setOfficetelStatus('error');
        return;
      }
      resolvedLawdCdRef.current = lawdCd;
      setCurrentLawdCd(lawdCd);
      fetchOfficetelMarkers(lawdCd);
    });
  };

  const togglePropertyType = (key: PropertyTypeLayer) => {
    const turningOn = !layers[key];
    setLayers((prev) => togglePropertyLayer(prev, key));

    if (!turningOn) {
      // 끄면 그 레이어의 마커·선택·카드를 즉시 정리한다. 반대편은 건드리지 않는다.
      if (key === 'apt') clearAptLayer();
      else clearOfficetelLayer();
      return;
    }

    if (key === 'apt') {
      setAptStatus('loading');
      setIsLoadingData(true);
      fetchAptMarkers(center.lat, center.lng, resolvedLawdCdRef.current ?? undefined);
    } else {
      loadOfficetelForCurrentArea();
    }
  };

  const toggleLayer = (key: LayerKey) => {
    if (key === 'apt' || key === 'officetel') {
      togglePropertyType(key);
      return;
    }

    const turningOn = !layers[key];
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

    // 이번에 새로 켠 레이어라면 현재 중심 기준으로 즉시 데이터를 채운다.
    if (turningOn && key === 'school') fetchSchoolMarkers(center.lat, center.lng);
  };

  // 아파트 자동완성에서 단지를 선택하면 실제 kakao.maps.Map 인스턴스의 panTo로 부드럽게
  // 이동시킨다(마커 재조회 등으로 인한 리렌더가 center state를 되돌리지 못하도록 state도
  // 함께 갱신한다 — panTo만 호출하면 다음 setCenter 호출 없는 리렌더에서는 문제 없지만,
  // 이후 다른 흐름이 center state를 참조할 때 최신 위치와 어긋나는 것을 방지). 선택한 단지가
  // 있는 지역의 마커도 함께 새로 불러온다.
  // MAP_LAYER_TOGGLE_V1 §9 — 검색으로 고른 종류의 레이어는 **반드시 켠다**. 다만 반대편
  // 종류는 그대로 둔다(끄지 않는다). 예: 아파트만 켠 상태에서 오피스텔을 검색하면
  // 아파트 ON + 오피스텔 ON이 되고, 고른 오피스텔이 정확히 선택된다.
  const handleSearchSelect = (result: ApartmentSearchResult) => {
    const layerKey = propertyLayerForSearchResult(result.type);
    if (layerKey === 'officetel') {
      handleOfficetelSearchSelect(result);
      return;
    }
    if (layerKey === 'apt' && !layers.apt) {
      // 아파트 레이어가 꺼져 있었으면 켠다. 아래 handleApartmentSelect가 조회할 레이어를
      // 명시적으로 넘기므로, 아직 갱신되지 않은 layers 클로저를 읽는 문제가 없다.
      setLayers((prev) => ensurePropertyLayerVisible(prev, 'apt'));
    }
    handleApartmentSelect(result);
  };

  /**
   * MAP_UX_V2 §12 — 오피스텔 검색 → 지도 핸드오프.
   *
   * 이름/부분주소/최근접 좌표/첫 마커로 매칭하지 않는다. 검색 결과가 이미 들고 온
   * **정확한 officetelId**를 보관해두고, 그 구의 마커가 도착했을 때 그 id와 정확히
   * 일치하는 마커만 선택한다. 좌표는 master에 저장된 값만 쓰며(런타임 지오코딩 금지),
   * 좌표가 없는 master(부산 8건)는 지도로 이동하지 않고 그 사실을 알린다.
   */
  const handleOfficetelSearchSelect = (result: ApartmentSearchResult) => {
    const officetelId = result.officetelId;
    if (!officetelId) return; // identity가 없으면 아무것도 하지 않는다(추측 금지).

    // §9 — 오피스텔 레이어를 켠다. **아파트 레이어는 건드리지 않는다**(켜져 있었다면
    // 그대로 켜진 채 남는다). §10 — 선택은 오피스텔 쪽으로 옮기므로 아파트 선택/카드만
    // 닫아 두 카드가 동시에 뜨는 것을 막는다(레이어를 끄는 것과는 다르다).
    setLayers((prev) => ensurePropertyLayerVisible(prev, 'officetel'));
    setSelectedMarkerId(null);
    setHoveredMarkerId(null);
    setPendingSelectedApt(null);
    setPendingRestoreIdentity(null);
    setSelectedOfficetelId(null);
    setHoveredOfficetelId(null);
    setOfficetelGroupList(null);

    if (!hasUsableHandoffCoords(result)) {
      // 좌표 미해결 master — 지도로 데려갈 수 없다는 사실을 정직하게 말한다.
      setOfficetelStatus('idle');
      setOfficetelHandoffNotice(`${result.name}은(는) 위치 정보가 없어 지도에 표시할 수 없습니다.`);
      return;
    }
    setOfficetelHandoffNotice(null);

    const latLng = { lat: result.lat, lng: result.lng };
    setCenter(latLng);
    if (mapRef.current && window.kakao?.maps) {
      const map = mapRef.current;
      const anchor = new window.kakao.maps.LatLng(latLng.lat, latLng.lng);
      map.panTo(anchor);
      // §10 — 낱개 마커가 보이는 단계까지 확대해서 내려놓는다. 묶음 배지만 뜨면 "내가
      // 고른 그 오피스텔"을 화면에서 확인할 수 없다. 혼합 모드는 오피스텔 낱개 한계가
      // 한 단계 더 조여 있으므로(§6) 그 값을 써야 한다 — 레벨 3으로 고정하면 혼합
      // 모드에서 고른 결과가 배지 뒤에 숨는다.
      const targetLevel = layers.apt ? MIXED_OFFICETEL_INDIVIDUAL_MAX_LEVEL : INDIVIDUAL_MARKER_MAX_LEVEL;
      if (map.getLevel() > targetLevel) {
        map.setLevel(targetLevel, { anchor });
        setZoomLevel(targetLevel);
      }
    }

    // 도착할 마커 중 이 id와 정확히 일치하는 것만 선택한다(아래 effect).
    setPendingOfficetelId(officetelId);
    setOfficetelStatus('loading');
    // §9 — 오피스텔은 반드시 조회하고, 아파트는 **현재 상태 그대로** 유지한다.
    refreshActiveLayers(latLng.lat, latLng.lng, result.lawdCd || undefined, {
      apt: layers.apt,
      officetel: true,
    });
  };

  const handleApartmentSelect = (result: ApartmentSearchResult) => {
    perfMark('map:m0-click'); // §12 M0
    const latLng = { lat: result.lat, lng: result.lng };
    setCenter(latLng);
    if (mapRef.current && window.kakao?.maps) {
      const anchor = new window.kakao.maps.LatLng(latLng.lat, latLng.lng);
      const map = mapRef.current;
      map.panTo(anchor);
      // MAP_UX_V2 §6 — 낱개 마커가 보이는 단계까지 확대해서 내려놓는다. 예전에는 3을
      // 그대로 적었는데, 이제 밀도 임계값이 한 곳(map-property-focus)에 있으므로 그
      // 상수를 쓴다 — 임계값이 바뀌어도 "고른 단지가 배지 뒤에 숨는" 일이 없다.
      if (map.getLevel() > INDIVIDUAL_MARKER_MAX_LEVEL) {
        map.setLevel(INDIVIDUAL_MARKER_MAX_LEVEL, { anchor });
        setZoomLevel(INDIVIDUAL_MARKER_MAX_LEVEL);
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
    // 아파트를 고른 경우 포커스를 명시해, 방금 setLayers한 값이 아직 반영되지 않은
    // 클로저 때문에 오피스텔을 조회하는 일이 없게 한다(§5/§14).
    refreshActiveLayers(latLng.lat, latLng.lng, result.lawdCd || undefined, {
      // 아파트를 골랐으면 아파트는 반드시 조회한다(방금 켰을 수 있다). 오피스텔은
      // 현재 상태 그대로 — 검색이 다른 종류를 임의로 끄지 않는다(§9).
      apt: result.type === 'APARTMENT' ? true : layers.apt,
      officetel: layers.officetel,
    });

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
  // MAP_UX_V2 §2 — "단지"는 무엇을 뜻하는지 모호했다(아파트 단지? 오피스텔 단지?).
  // 화면 라벨만 "아파트"로 바꾸고 내부 state 키(apt)는 그대로 둔다. 향후 용어 체계는
  // 아파트 / 오피스텔 / 생활형숙박시설 / 전체이며, 뒤의 둘은 이 STEP 범위가 아니다.
  const LAYER_LABEL: Record<LayerKey, string> = {
    apt: '아파트',
    officetel: '오피스텔',
    livingLodging: '생숙',
    redevelopment: '재개발',
    auction: '경·공매',
    school: '학교',
  };
  const LAYER_ORDER: LayerKey[] = ['apt', 'officetel', 'livingLodging', 'redevelopment', 'auction', 'school'];
  // OFFICETEL_MAP_LAYER_V1 §6 — officetel은 더 이상 준비중이 아니다(부산 5,048개 저장
  // 좌표로 실제 마커를 그린다). 나머지 셋은 여전히 연동된 데이터 소스가 없다.
  const COMING_SOON_LAYERS: LayerKey[] = ['livingLodging', 'redevelopment', 'auction'];
  const COMING_SOON_MESSAGE: Partial<Record<LayerKey, string>> = {
    livingLodging: '생활숙박시설(생숙) 실거래 데이터는 아직 연동 준비 중입니다.',
    redevelopment: '재개발/재건축 구역 데이터는 아직 연동 준비 중입니다.',
    auction: '경매/공매 매물 데이터는 아직 연동 준비 중입니다.',
  };
  const activeComingSoon = COMING_SOON_LAYERS.filter((key) => layers[key]);

  // §6 — 오피스텔 레이어는 teal, 아파트는 기존 이집 Green. 색만으로 구분하지 않도록
  // 활성 칩에는 작은 건물 아이콘도 함께 붙인다.
  const layerActiveBg = (key: LayerKey) => (key === 'officetel' ? OFFI.fill : 'var(--primary-color)');

  // §12 — 지도 하단 상태 문구. "매물"이라는 말은 쓰지 않는다(이 마커들은 매물 인벤토리가
  // 아니다). 두 종류를 동시에 켤 수 있으므로 세 경우를 모두 구분한다.
  const aptLoading = layers.apt && isLoadingData;
  const officetelLoading = layers.officetel && officetelStatus === 'loading';
  const loadingMessage =
    aptLoading && officetelLoading
      ? '주변 부동산 정보를 불러오는 중...'
      : officetelLoading
        ? '주변 오피스텔을 불러오는 중...'
        : '주변 아파트를 불러오는 중...';

  // §13 — 아파트도 실패(FAILED)와 진짜 0건(ZERO)을 구분한다. 혼합 모드에서 한쪽만
  // 실패하면 그 레이어만 실패로 말하고, 성공한 레이어는 그대로 쓸 수 있어야 한다.
  const aptNotice: { text: string; tone: 'info' | 'error' } | null = (() => {
    if (!layers.apt) return null;
    if (aptStatus === 'error') return { text: '아파트 정보를 불러오지 못했습니다.', tone: 'error' };
    if (aptStatus !== 'ready') return null;
    // TRANSACTIONS_API_TRUST_V1 — 부분 실패는 전체 실패도, 진짜 0건도 아니다. 마커가
    // 0건이면 "없다"가 아니라 "못 불러왔다"에 가깝고, 마커가 있어도 실제보다 적을 수
    // 있으므로 두 경우 모두 부분 실패를 먼저 말한다.
    if (aptPartial) {
      return { text: '일부 거래 정보를 불러오지 못해 아파트가 실제보다 적게 표시될 수 있습니다.', tone: 'info' };
    }
    if (aptMarkers.length === 0) {
      return { text: '현재 지도 범위에 표시할 아파트가 없습니다.', tone: 'info' };
    }
    return null;
  })();

  // §14 — 실패(FAILED)와 진짜 0건(ZERO)을 절대 같은 문구로 접지 않는다.
  const officetelNotice: { text: string; tone: 'info' | 'error' } | null = (() => {
    // §12 — 좌표가 없어 지도로 데려갈 수 없는 검색 결과를 골랐을 때의 안내가 최우선이다.
    if (officetelHandoffNotice) return { text: officetelHandoffNotice, tone: 'info' };
    if (!layers.officetel) return null;
    if (officetelStatus === 'error') return { text: '오피스텔 정보를 불러오지 못했습니다.', tone: 'error' };
    if (officetelStatus !== 'ready') return null;
    if (zoomLevel > OFFICETEL_MAX_ZOOM_LEVEL) {
      return { text: '지도를 확대하면 오피스텔 마커가 표시됩니다.', tone: 'info' };
    }
    if (officetelHiddenByCap > 0) {
      return {
        text: `이 범위의 오피스텔이 많아 ${officetelHiddenByCap.toLocaleString()}곳을 더 표시하지 못했습니다. 확대하면 모두 볼 수 있습니다.`,
        tone: 'info',
      };
    }
    // 아직 이 마커 목록으로 클러스터를 계산하지 않았으면 "없다"고 말하지 않는다.
    if (officetelClusteredFrom !== officetelMarkers) return null;
    if (officetelClusters.length === 0) {
      // §11 — 좌표가 없어 지도에 올릴 수 없는 master가 이 구에 있으면 그 사실을 함께
      // 알린다. "없다"와 "위치 정보가 없어 못 그린다"는 다른 상태다.
      return {
        text:
          officetelExcluded > 0
            ? `현재 지도 범위에 표시할 오피스텔이 없습니다. (이 지역 오피스텔 ${officetelExcluded.toLocaleString()}곳은 위치 정보가 없어 지도에 표시할 수 없습니다.)`
            : '현재 지도 범위에 표시할 오피스텔이 없습니다.',
        tone: 'info',
      };
    }
    return null;
  })();

  return (
    <div ref={mapViewportRef} style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {/* PERCEIVED_PERFORMANCE_V2 §4 — 이 화면은 SDK/Local(dapi)과 타일(mts.daumcdn.net)을
          모두 반드시 쓴다. 두 호스트의 핸드셰이크를 미리 끝내둔다. */}
      <KakaoPreconnect withTiles />
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
            {/* MAP_UX_V2 §12 — includeOfficetel을 켠다. 예전에는 이 프롭이 빠져 있어
                기본값 false가 적용됐고, placeholder는 "아파트, 오피스텔"이라고 약속하면서
                실제로는 오피스텔 결과가 목록에 아예 나오지 않았다(핸드오프 미완의 1차 원인).
                아래 handleSearchSelect가 OFFICETEL 분기를 정확 identity로 처리한다. */}
            <ApartmentAutocomplete
              onSelect={handleSearchSelect}
              includeOfficetel
              placeholder="🔍 아파트, 오피스텔 단지명 검색..."
            />
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
      {/* 터치 타깃 44px(MAP_UX_V2 §17). MAP_LAYER_TOGGLE_V1 §4 — 여섯 칩이 모두
          독립 토글이므로 접근성 의미도 aria-pressed 하나로 통일한다. */}
      <div ref={rightControlRef} style={{ position: 'absolute', right: '12px', top: '64px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {LAYER_ORDER.map((key) => {
          const active = layers[key];
          return (
            <button
              key={key}
              onClick={() => toggleLayer(key)}
              style={{
                minHeight: 44,
                padding: '0 1rem',
                borderRadius: '99px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.8rem',
                background: active ? layerActiveBg(key) : 'rgba(255,255,255,0.95)',
                color: active ? 'white' : 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
              // §4 — 매물 레이어도 이제 배타 그룹이 아니라 독립 토글이다.
              // role="radio" / aria-checked(배타)를 쓰지 않고 프로젝트의 기존 관례인
              // aria-pressed로 통일한다.
              aria-pressed={active}
            >
              {key === 'officetel' && <Building2 size={13} aria-hidden="true" style={{ flexShrink: 0 }} />}
              {key === 'apt' && <Home size={13} aria-hidden="true" style={{ flexShrink: 0 }} />}
              {LAYER_LABEL[key]}
            </button>
          );
        })}
      </div>

      {/* 아직 데이터 연동이 안 된 레이어를 켰을 때: 지어낸 마커 대신 정직하게 준비중 안내 */}
      {/* OFFICETEL_MAP_LAYER_V1 §13/§14 — 하단 상태 배너들을 한 세로 스택으로 묶는다.
          예전에는 준비중 안내와 로딩 안내가 각각 bottom:76px에 절대배치돼 동시에 뜨면
          서로 완전히 겹쳤다(오피스텔 안내가 추가되며 세 개가 겹칠 수 있게 됐다). */}
      <div
        style={{
          position: 'absolute', bottom: '76px', left: '16px', right: '16px', zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
          pointerEvents: 'none',
        }}
      >
      {activeComingSoon.length > 0 && (
        <div
          style={{
            padding: '0.75rem 1.25rem', background: 'rgba(30,41,59,0.92)', color: 'white', borderRadius: '12px',
            fontSize: '0.85rem', fontWeight: 600, textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            maxWidth: '100%',
          }}
        >
          {activeComingSoon.map((key) => COMING_SOON_MESSAGE[key]).join(' ')}
        </div>
      )}

      {/* MAP_PERFORMANCE_V1 — 지도 자체는 이미 떴고(isMapReady) 주변 마커만 아직
          fetch 중일 때 보여주는 작은, 화면을 막지 않는 안내. 예전 FullPageLoader처럼
          지도 전체를 가리지 않고, 사용자가 그 사이에도 바로 pan/zoom할 수 있다(§42). */}
      {(aptLoading || officetelLoading) && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.95)', borderRadius: '99px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)',
            maxWidth: '100%', whiteSpace: 'nowrap',
          }}
          role="status"
          aria-live="polite"
        >
          <span
            className={mapMarkerStyles.markerLoadingSpinner}
            style={{
              display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%',
              border: '2px solid rgba(0,0,0,0.15)',
              borderTopColor: officetelLoading ? OFFI.line : 'var(--primary-color)',
            }}
            aria-hidden="true"
          />
          {loadingMessage}
        </div>
      )}

      {/* OFFICETEL_MAP_LAYER_V1 §14 — 빈 범위 / 확대 안내 / 렌더 상한 / 조회 실패를
          서로 다른 문구로 구분한다. 실패를 "오피스텔이 없습니다"로 말하지 않는다. */}
      {/* 아파트 레이어가 아직 로딩 중이어도 오피스텔 안내는 가리지 않는다 — 두 배너는
          같은 세로 스택 안에 쌓이므로 겹치지 않고, 아파트 조회가 느린 구(12개월 실거래)
          에서 오피스텔 상태만 오래 숨겨지는 문제를 막는다. */}
      {!aptLoading && aptNotice && (
        <div
          style={{
            padding: '0.55rem 1rem', borderRadius: '12px',
            background: aptNotice.tone === 'error' ? 'rgba(185,28,28,0.94)' : 'rgba(21,94,63,0.94)',
            color: 'white', fontSize: '0.8rem', fontWeight: 600, textAlign: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)', maxWidth: '100%',
          }}
          role="status"
          aria-live="polite"
        >
          {aptNotice.text}
        </div>
      )}

      {!officetelLoading && officetelNotice && (
        <div
          style={{
            padding: '0.55rem 1rem', borderRadius: '12px',
            background: officetelNotice.tone === 'error' ? 'rgba(185,28,28,0.94)' : OFFI.banner,
            color: 'white', fontSize: '0.8rem', fontWeight: 600, textAlign: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)', maxWidth: '100%',
          }}
          role="status"
          aria-live="polite"
        >
          {officetelNotice.text}
        </div>
      )}
      </div>


      <KakaoMap
        ref={mapRef}
        center={center}
        style={{ width: '100%', height: '100%' }}
        // OFFICETEL_MAP_LAYER_V1 §15 — 예전에는 level이 4로 하드코딩돼 있어서, 공유
        // 링크의 zoom이 zoomLevel state에만 들어가고 실제 지도는 항상 레벨 4로 떴다
        // (= state와 지도의 확대 단계가 서로 다른 상태). 아파트 칩은 그 불일치를
        // 눈치채기 어려웠지만, 오피스텔 레이어는 확대 단계로 표시 여부를 판단하므로
        // 두 값이 어긋나면 "확대하면 보입니다"가 잘못 뜬다. onZoomChanged가 이미
        // 지도의 실제 레벨로 state를 갱신하므로 여기서 state를 그대로 넘기면 둘이
        // 항상 같은 값으로 수렴한다(기본 진입은 zoom 파라미터가 없어 4 그대로).
        level={zoomLevel}
        onDragEnd={handleDragEnd}
        onZoomChanged={(map) => setZoomLevel(map.getLevel())}
        onClick={() => {
          setSelectedMarkerId(null);
          setPendingSelectedApt(null);
          setPendingRestoreIdentity(null);
          setSelectedOfficetelId(null);
          setOfficetelGroupList(null);
          setOfficetelHandoffNotice(null);
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

            // MAP_UX_V2 §9 — 축소 상태(레벨 4 이상)에서는 겹친 단지들을 격자로 펼치지
            // 않고 **개수 배지 하나**로 그린다. 이 단계에서 가격 칩을 전부 펼치면 서로
            // 겹쳐 어차피 읽을 수 없고 지도까지 덮는다(실측: 서면 360px 80% 피복).
            // 누르면 한 단계 확대되어 그 자리에서 개별 가격 칩으로 풀린다 —
            // 거래 데이터/가격 의미/식별자/상세 경로는 전혀 바뀌지 않는다.
            if (aptDensity !== 'individual') {
              return (
                <CustomOverlayMap
                  key={cluster.id}
                  position={{ lat: cluster.lat, lng: cluster.lng }}
                  yAnchor={0.5}
                  zIndex={clusterSelected ? 9999 : 1}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`아파트 ${cluster.markers.length}곳, 확대해서 보기`}
                    title={`아파트 ${cluster.markers.length}곳`}
                    onClick={() => zoomIntoCluster(cluster.lat, cluster.lng)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        zoomIntoCluster(cluster.lat, cluster.lng);
                      }
                    }}
                    className={mapMarkerStyles.markerChip}
                    style={{
                      transform: `translate(${nudge.dx}px, ${nudge.dy}px)`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: '4px 9px',
                      borderRadius: '999px',
                      background: 'white',
                      border: '2px solid var(--primary-color)',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.12)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Home size={12} color="var(--primary-hover)" strokeWidth={2.5} aria-hidden="true" />
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--primary-hover)' }}>
                      {cluster.markers.length}
                    </span>
                  </div>
                </CustomOverlayMap>
              );
            }

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

        {/* MAP_UX_V2 §7/§8 — 오피스텔은 세 가지 형태로만 그려진다:
            1) 픽셀 클러스터(여러 좌표가 화면에서 겹침) → 개수 배지. 누르면 확대.
            2) 좌표 그룹(같은 좌표에 여러 master) → 개수 배지. 누르면 **선택 목록**.
               확대해도 갈라지지 않는 겹침이므로 확대가 아니라 목록으로 푼다.
            3) 단일 master → 낱개 칩(확대 상태에서만 이름 표시).
            어느 경우에도 데이터를 합치지 않는다 — 선택은 언제나 개별 master다. */}
        {layers.officetel && officetelClusters.map((cluster) => {
          const baseNudge = officetelNudges.get(cluster.id) ?? { dx: 0, dy: 0 };
          // §8 MIXED OVERLAP — 혼합 모드에서만 오피스텔 오버레이를 살짝 내려 아파트
          // 말풍선과 같은 지점에 겹치지 않게 한다(단독 모드에서는 0px = 기존 그대로).
          const nudge = { dx: baseNudge.dx, dy: baseNudge.dy + officetelOverlapDy };
          const clusterSelected = cluster.markers.some((g) =>
            g.members.some((m) => m.id === activeOfficetelId)
          );
          const clusterMasters = cluster.markers.reduce((s, g) => s + g.members.length, 0);

          // 1) 화면에서 겹친 여러 좌표 → 확대로 푼다.
          const spreadsIntoIndividuals = isOfficetelDetailed;
          if (!spreadsIntoIndividuals && clusterMasters > 1) {
            return (
              <CustomOverlayMap
                key={cluster.id}
                position={{ lat: cluster.lat, lng: cluster.lng }}
                yAnchor={0.5}
                zIndex={clusterSelected ? 9998 : 1}
              >
                <OfficetelGroupBadge
                  count={clusterMasters}
                  label={`오피스텔 ${clusterMasters}곳, 확대해서 보기`}
                  offset={nudge}
                  onActivate={() => zoomIntoCluster(cluster.lat, cluster.lng)}
                />
              </CustomOverlayMap>
            );
          }

          const renderGroup = (group: OfficetelCoordGroup, offset: { dx: number; dy: number }, key: string, z: number) => {
            // 2) 같은 좌표에 여러 master — 확대해도 갈라지지 않으므로 목록으로 푼다(§8).
            if (group.members.length > 1) {
              const picked = group.members.find((m) => m.id === activeOfficetelId) ?? null;
              const rest = picked ? group.members.filter((m) => m.id !== picked.id) : group.members;
              return (
                <CustomOverlayMap key={key} position={{ lat: group.lat, lng: group.lng }} yAnchor={0.5} zIndex={picked ? 9998 : z}>
                  <div style={{ position: 'relative' }}>
                    {/* §10 — 선택된 identity 하나만 묶음에서 **일시적으로 꺼내** 낱개 칩으로
                        그린다. 검색으로 고른 오피스텔이 묶음 배지 뒤에 숨지 않게 하기 위한
                        표시 처리이며, 나머지 형제들은 옆의 배지로 그대로 선택할 수 있다. */}
                    {picked && (
                      <div style={{ position: 'absolute', left: offset.dx, top: offset.dy, transform: 'translate(-50%, -50%)', zIndex: 2 }}>
                        {renderOfficetelChip(picked, true)}
                      </div>
                    )}
                    <div
                      style={{
                        position: 'absolute',
                        left: offset.dx + (picked ? officetelChipLayout.width / 2 + 20 : 0),
                        top: offset.dy,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 1,
                      }}
                    >
                      <OfficetelGroupBadge
                        count={rest.length}
                        label={
                          picked
                            ? `같은 위치의 다른 오피스텔 ${rest.length}곳, 목록 열기`
                            : `같은 위치의 오피스텔 ${rest.length}곳, 목록 열기`
                        }
                        offset={{ dx: 0, dy: 0 }}
                        stacked
                        onActivate={() => {
                          setOfficetelGroupList(group.members);
                          setSelectedOfficetelId(null);
                          setSelectedMarkerId(null);
                          setPendingSelectedApt(null);
                        }}
                      />
                    </div>
                  </div>
                </CustomOverlayMap>
              );
            }
            // 3) 단일 master.
            const marker = group.members[0];
            const selected = marker.id === activeOfficetelId;
            return (
              <CustomOverlayMap key={key} position={{ lat: group.lat, lng: group.lng }} yAnchor={0.5} zIndex={selected ? 9998 : z}>
                <div style={{ transform: `translate(${offset.dx}px, ${offset.dy}px)` }}>
                  {renderOfficetelChip(marker, selected)}
                </div>
              </CustomOverlayMap>
            );
          };

          // 확대 상태에서 여러 좌표가 한 클러스터에 있으면 격자로 벌려 각각 그린다.
          if (cluster.markers.length > 1) {
            const cols = Math.ceil(Math.sqrt(cluster.markers.length));
            const rows = Math.ceil(cluster.markers.length / cols);
            return (
              <React.Fragment key={cluster.id}>
                {cluster.markers.map((group, i) => {
                  const col = i % cols;
                  const row = Math.floor(i / cols);
                  return renderGroup(
                    group,
                    {
                      dx: (col - (cols - 1) / 2) * (officetelChipLayout.width + officetelChipLayout.gap) + nudge.dx,
                      dy: (row - (rows - 1) / 2) * (officetelChipLayout.height + officetelChipLayout.gap) + nudge.dy,
                    },
                    `${cluster.id}:${group.id}`,
                    i
                  );
                })}
              </React.Fragment>
            );
          }

          return renderGroup(cluster.markers[0], nudge, cluster.id, 1);
        })}

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

      {/* OFFICETEL_MAP_LAYER_V1 §8 — 오피스텔 마커 클릭 카드. 실제 master 값만 쓴다:
          표시명(빈 이름은 "법정동 지번 오피스텔") / 주소 / 규모(호). 세대수·대표평형·
          시세·추정가·역대 최고가는 **표시하지 않는다**(원천에 없거나 BLOCKED). */}
      {/* MAP_UX_V2 §8 — 같은 좌표에 등록된 오피스텔들의 선택 목록. 지도에서는 절대
          분리할 수 없는 겹침이므로 목록으로 고르게 한다. 각 항목은 자기 master id를
          그대로 들고 있고, 어느 항목도 다른 항목을 대표하지 않는다. */}
      {officetelGroupList && (
        <div
          style={{
            position: 'fixed', bottom: '60px', left: 0, right: 0, zIndex: 1002,
            background: 'white', borderTop: '1px solid var(--border-color)',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.12)', padding: '1rem',
            borderRadius: '16px 16px 0 0', maxHeight: '52vh', overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
            <div style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: OFFI.soft, color: OFFI.line, borderRadius: '6px',
                  padding: '2px 6px', fontSize: '0.68rem', fontWeight: 800,
                }}
              >
                <Building2 size={11} aria-hidden="true" />
                오피스텔 {officetelGroupList.length}곳
              </span>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                {officetelMarkerAddressLine(officetelGroupList[0]) ?? '같은 위치'}
                {' · 같은 위치에 등록된 건물입니다.'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOfficetelGroupList(null)}
              aria-label="닫기"
              style={{ minWidth: 44, minHeight: 44, padding: '0.4rem', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer', flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
          <ul style={{ listStyle: 'none', margin: '0.75rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {officetelGroupList.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  // §8/§12 — 항목마다 정확한 master id로만 이동한다.
                  onClick={() => router.push(`/officetel/${m.officetelId}`)}
                  style={{
                    width: '100%', minHeight: 44, display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', gap: '0.5rem', textAlign: 'left',
                    padding: '0.5rem 0.75rem', borderRadius: '10px', cursor: 'pointer',
                    background: 'white', border: `1px solid ${OFFI.soft}`,
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.displayName}
                    </span>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {m.buildingDong ? `${m.buildingDong} · ` : ''}
                      {typeof m.hoCnt === 'number' && m.hoCnt > 0 ? `${m.hoCnt.toLocaleString()}호` : '규모 정보 없음'}
                    </span>
                  </span>
                  <span style={{ flexShrink: 0, fontSize: '0.78rem', fontWeight: 700, color: OFFI.line }}>상세보기</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!officetelGroupList && selectedOfficetel && (
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
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: OFFI.soft, color: OFFI.line, borderRadius: '6px',
                  padding: '2px 6px', fontSize: '0.68rem', fontWeight: 800,
                }}
              >
                <Building2 size={11} aria-hidden="true" />
                오피스텔
              </span>
              <div
                style={{
                  fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)', marginTop: '4px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {selectedOfficetel.displayName}
              </div>
              {officetelMarkerAddressLine(selectedOfficetel) && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {officetelMarkerAddressLine(selectedOfficetel)}
                  {selectedOfficetel.buildingDong ? ` ${selectedOfficetel.buildingDong}` : ''}
                </div>
              )}
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {/* 규모 단위는 **호**다. 값이 없으면 지어내지 않고 "정보 없음"으로 둔다. */}
                규모{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {typeof selectedOfficetel.hoCnt === 'number' && selectedOfficetel.hoCnt > 0
                    ? `${selectedOfficetel.hoCnt.toLocaleString()}호`
                    : '정보 없음'}
                </strong>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedOfficetelId(null);
                setHoveredOfficetelId(null);
              }}
              aria-label="닫기"
              style={{ minWidth: 44, minHeight: 44, padding: '0.4rem', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer', flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            // §9 — 정확한 master id로만 이동한다.
            onClick={() => router.push(`/officetel/${selectedOfficetel.officetelId}`)}
            // §17 — 모바일 터치 타깃 44px 확보(실측: 0.7rem 패딩만으로는 38px였다).
            style={{ marginTop: '0.75rem', width: '100%', minHeight: 44, padding: '0.7rem', background: OFFI.fill, color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: 'pointer' }}
          >
            상세보기
          </button>
        </div>
      )}

      {!officetelGroupList && !selectedOfficetel && selectedMarker && (
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
          {/* REPORT-7 §5 — 선택된 단지 카드 안에서는 단지 리포트가 지역 브리핑보다
              우선한다. canonical aptSeq가 있을 때만 노출해 이름 기반 식별을 피한다.
              팝업을 더 무겁게 만들지 않도록 보조 버튼 하나만 추가한다. */}
          {selectedMarker.aptSeq && (
            <button
              type="button"
              onClick={() => router.push(`/report/apt/${encodeURIComponent(selectedMarker.aptSeq!)}`)}
              style={{ marginTop: '0.5rem', width: '100%', padding: '0.7rem', background: '#fff', color: 'var(--primary-color)', border: '1px solid var(--primary-color)', borderRadius: '10px', fontWeight: 700, cursor: 'pointer' }}
            >
              {REPORT_LABELS.aptShort}
            </button>
          )}
          <AdContainer variant="agent" slot="map-marker-summary-agent" label="추천 지역 중개사" />
        </div>
      )}

      <BottomNav />
    </div>
  );
}
