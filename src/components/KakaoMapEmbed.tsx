'use client';

// 지도/로드뷰 임베드. **두 가지 모드**를 명시적으로 가진다(OFFICETEL_V1 STEP 6 §2).
//
//   mode="address"     아파트 기존 경로. 런타임 지오코딩(도로명 → 지번 → 키워드).
//   mode="coordinate"  저장된 신뢰 좌표. 지오코딩을 **한 번도 하지 않는다**.
//
// 두 모드는 타입 수준에서 갈라져 있어 섞일 수 없다. 좌표 모드에 주소 폴백을 두면
// "지도가 틀렸는데 틀린 줄 모르는" 상태가 생기고, 그건 지도가 없는 것보다 나쁘다(§6).
//
// 지도와 로드뷰는 **각자의 컨테이너를 계속 들고 있고** 보이기만 바뀐다. 예전에는
// type이 바뀔 때마다 전체를 다시 만들어서 주소 모드에서는 지오코딩이 다시 돌고
// 좌표 모드에서는 사용자가 맞춰둔 줌/중심이 날아갔다(§5).
import React, { useEffect, useRef, useState } from 'react';
import { loadKakaoMapsSdk } from '@/lib/kakao/maps-sdk';
import { planMapEmbed, kakaoSdkErrorMessage, type LocationView } from '@/lib/kakao/map-embed-logic';

type Props =
  | { mode: 'address'; address: string; jibunAddress?: string; type: LocationView }
  | { mode: 'coordinate'; latitude: number; longitude: number; type: LocationView };

const ROADVIEW_SEARCH_RADIUS_M = 200;

export default function KakaoMapEmbed(props: Props) {
  const { type } = props;

  const mapRef = useRef<HTMLDivElement>(null);
  const rvRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const rvInstance = useRef<any>(null);
  const coordsRef = useRef<any>(null);

  const [error, setError] = useState('');
  const [noRoadview, setNoRoadview] = useState(false);
  const [ready, setReady] = useState(false);

  // effect 의존성을 원시값으로 고정한다 — props 객체를 그대로 의존성에 넣으면
  // 매 렌더마다 좌표 확보가 다시 돈다.
  const mode = props.mode;
  const address = props.mode === 'address' ? props.address : '';
  const jibunAddress = props.mode === 'address' ? props.jibunAddress : undefined;
  const latitude = props.mode === 'coordinate' ? props.latitude : null;
  const longitude = props.mode === 'coordinate' ? props.longitude : null;

  // ── 1단계: SDK 로드 + 좌표 확보 (type과 무관) ────────────────────────
  useEffect(() => {
    let alive = true;
    setError('');
    setReady(false);
    setNoRoadview(false);
    mapInstance.current = null;
    rvInstance.current = null;
    coordsRef.current = null;

    const plan =
      mode === 'coordinate'
        ? planMapEmbed({ mode, latitude: latitude as number, longitude: longitude as number })
        : planMapEmbed({ mode, address, jibunAddress });

    if (plan.kind === 'UNRESOLVABLE') {
      setError('위치를 찾을 수 없습니다.');
      return;
    }

    loadKakaoMapsSdk()
      .then(() => {
        if (!alive) return;

        if (plan.kind === 'USE_STORED_COORDINATE') {
          // 저장된 좌표가 곧 렌더의 authority다. Geocoder/Places를 만들지도 않는다.
          coordsRef.current = new window.kakao.maps.LatLng(plan.latitude, plan.longitude);
          setReady(true);
          return;
        }

        // ── 주소 모드: 기존 아파트 동작을 그대로 보존한다 ──
        const geocoder = new window.kakao.maps.services.Geocoder();
        const ps = new window.kakao.maps.services.Places();

        // 카카오 응답의 x/y는 문자열이다. LatLng에는 수치로 넘긴다.
        const accept = (lat: string, lng: string) => {
          if (!alive) return;
          coordsRef.current = new window.kakao.maps.LatLng(Number(lat), Number(lng));
          setReady(true);
        };

        const searchKeyword = () => {
          ps.keywordSearch(plan.address, (places: any, status: any) => {
            if (!alive) return;
            if (status === window.kakao.maps.services.Status.OK) {
              accept(places[0].y, places[0].x);
            } else {
              console.error(
                `Geocoding failed for both address(${plan.address}) and jibun(${plan.jibunAddress}). Keyword search also failed.`
              );
              setError('위치를 찾을 수 없습니다.');
            }
          });
        };

        const searchJibun = () => {
          if (!plan.jibunAddress) {
            searchKeyword();
            return;
          }
          geocoder.addressSearch(plan.jibunAddress, (result: any, status: any) => {
            if (!alive) return;
            if (status === window.kakao.maps.services.Status.OK) accept(result[0].y, result[0].x);
            else searchKeyword();
          });
        };

        geocoder.addressSearch(plan.address, (result: any, status: any) => {
          if (!alive) return;
          if (status === window.kakao.maps.services.Status.OK) accept(result[0].y, result[0].x);
          else searchJibun();
        });
      })
      .catch((e) => {
        if (alive) setError(kakaoSdkErrorMessage(e));
      });

    return () => {
      alive = false;
    };
  }, [mode, address, jibunAddress, latitude, longitude]);

  // ── 2단계: 보이는 쪽 인스턴스만 만든다 (좌표 확보는 다시 하지 않는다) ──
  useEffect(() => {
    if (!ready || !coordsRef.current) return;
    const coords = coordsRef.current;

    if (type === 'map') {
      if (!mapInstance.current && mapRef.current) {
        mapInstance.current = new window.kakao.maps.Map(mapRef.current, { center: coords, level: 3 });
        const marker = new window.kakao.maps.Marker({ position: coords });
        marker.setMap(mapInstance.current);
      } else if (mapInstance.current) {
        // 숨겨져 있던 동안의 크기 계산을 갱신한다. 중심/줌은 사용자가 둔 그대로 둔다.
        mapInstance.current.relayout();
      }
      return;
    }

    if (!rvInstance.current && rvRef.current) {
      const rv = new window.kakao.maps.Roadview(rvRef.current);
      rvInstance.current = rv;
      new window.kakao.maps.RoadviewClient().getNearestPanoId(coords, ROADVIEW_SEARCH_RADIUS_M, (panoId: any) => {
        if (panoId) rv.setPanoId(panoId, coords);
        else setNoRoadview(true);
      });
    } else if (rvInstance.current) {
      rvInstance.current.relayout();
    }
  }, [ready, type]);

  if (error) {
    return (
      <div
        style={{
          width: '100%', height: '100%', minHeight: '400px', display: 'flex',
          alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9',
          fontSize: '0.9rem', color: '#475569', textAlign: 'center', padding: '1rem',
        }}
      >
        {error}
      </div>
    );
  }

  const pane = (visible: boolean): React.CSSProperties => ({
    position: 'absolute',
    inset: 0,
    // display:none 이면 카카오가 컨테이너 크기를 0으로 읽어 다시 보일 때 깨진다.
    visibility: visible ? 'visible' : 'hidden',
  });

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '400px', borderRadius: '8px', overflow: 'hidden' }}>
      <div ref={mapRef} style={pane(type === 'map')} />
      <div ref={rvRef} style={pane(type === 'roadview')} />
      {type === 'roadview' && noRoadview && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', backgroundColor: '#f1f5f9', fontSize: '0.9rem',
            color: '#475569', textAlign: 'center', padding: '1rem',
          }}
        >
          {mode === 'coordinate'
            ? '이 위치는 로드뷰를 제공하지 않습니다.'
            : '해당 단지 근처의 로드뷰 정보를 찾을 수 없습니다.'}
        </div>
      )}
    </div>
  );
}
