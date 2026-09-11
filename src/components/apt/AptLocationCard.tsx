'use client';

// APT_DETAIL_INLINE_MAP_ROADVIEW_V1 — 아파트 상세의 위치 카드.
//
// ── 이 카드가 없애는 것 ─────────────────────────────────────────────────────
// 예전에는 [지도] [로드뷰] 버튼이 각각 **모달**을 열었다. 위치를 보려면 항상 한 번
// 더 눌러야 했고, 지도와 로드뷰가 서로 다른 모달이라 둘 사이를 오가려면 닫았다
// 다시 열어야 했다. 이제 지도는 상세 페이지 안에 그대로 있고, 지도↔로드뷰는
// **같은 컨테이너 안에서** 바뀐다. 라우트 이동도 모달도 없다.
//
// ── 좌표 신뢰 ───────────────────────────────────────────────────────────────
// 서버가 canonical identity로 해석해 준 좌표만 쓴다(mode="coordinate").
// KakaoMapEmbed의 좌표 모드는 Geocoder/Places를 **만들지도 않는다** — 런타임
// 지오코딩이 구조적으로 불가능하다. 좌표가 없으면 주소 모드로 떨어지지 않고
// 없다고 말한다. 틀린 위치는 위치가 없는 것보다 나쁘다.
//
// ── 성능 ────────────────────────────────────────────────────────────────────
// "지도가 바로 보인다"는 상세 초기 렌더를 Kakao SDK에 묶는다는 뜻이 아니다.
// 컨테이너는 처음부터 자리를 잡고 있고(레이아웃 시프트 없음), SDK는 카드가 화면에
// 다가올 때 로드된다(useLazyInView). 버튼 게이트가 없으므로 사용자 입장에서는
// 그냥 "지도가 거기 있는" 화면이다.
import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { Map as MapIcon, Camera, MapPin } from 'lucide-react';
import { locationCardState, toggleLocationView, type LocationView } from '@/lib/kakao/map-embed-logic';
import { useLazyInView } from '@/lib/kakao/use-lazy-in-view';
import { trackEvent } from '@/lib/analytics/trackEvent';
import styles from './AptLocationCard.module.css';

const KakaoMapEmbed = dynamic(() => import('@/components/KakaoMapEmbed'), {
  ssr: false,
  loading: () => <div className={styles.mapLoading}>지도를 불러오는 중…</div>,
});

interface Props {
  /** 서버가 canonical identity로 해석한 좌표. 없으면 null. */
  coords: { lat: number; lng: number } | null;
  /** 아직 좌표 해석이 끝나지 않았는가. true면 "없음"이 아니라 "확인 중"이다. */
  locationReady: boolean;
  /** 카드 부제로만 쓴다 — 위치 해석에는 절대 쓰이지 않는다. */
  addressLine?: string | null;
}

export default function AptLocationCard({ coords, locationReady, addressLine }: Props) {
  const state = locationCardState(coords ? { latitude: coords.lat, longitude: coords.lng } : null);
  const hasCoord = state === 'MAP_READY';

  const [view, setView] = useState<LocationView>('map');
  // §11 — 모드는 **하나의 상태**다. isMap/showRoadview 같은 불리언을 따로 두지 않는다.
  const { ref, inView } = useLazyInView<HTMLDivElement>({ enabled: hasCoord });

  // 지도가 실제로 붙는 순간 1회. 렌더마다가 아니라 lazy 트리거가 켜질 때만이라
  // 마운트당 1건이다.
  const [viewTracked, setViewTracked] = useState(false);
  if (inView && !viewTracked) {
    setViewTracked(true);
    trackEvent('detail_map_view');
  }

  const switchView = useCallback(() => {
    setView((current) => {
      const next = toggleLocationView(current);
      // §19 — 사용자가 실제로 누른 전환만 센다. 패닝/줌은 보내지 않는다.
      trackEvent(next === 'roadview' ? 'detail_roadview_open' : 'detail_map_return');
      return next;
    });
  }, []);

  return (
    <section className={styles.card} aria-label="단지 위치">
      <div className={styles.header}>
        <h2 className={styles.title}>
          <MapPin size={15} strokeWidth={2.2} aria-hidden="true" /> 위치
        </h2>

        {hasCoord && (
          // §3 — 두 모드를 모두 보여주고 현재 모드를 눌린 상태로 표시한다.
          // 라벨이 바뀌는 단일 버튼보다 "지금 무엇을 보고 있는지"가 분명하다.
          <div className={styles.switch} role="group" aria-label="지도 로드뷰 전환">
            <button
              type="button"
              className={styles.switchBtn}
              aria-pressed={view === 'map'}
              onClick={() => view !== 'map' && switchView()}
            >
              <MapIcon size={13} strokeWidth={2.2} aria-hidden="true" /> 지도
            </button>
            <button
              type="button"
              className={styles.switchBtn}
              aria-pressed={view === 'roadview'}
              onClick={() => view !== 'roadview' && switchView()}
            >
              <Camera size={13} strokeWidth={2.2} aria-hidden="true" /> 로드뷰
            </button>
          </div>
        )}
      </div>

      {!hasCoord ? (
        <div className={styles.empty}>
          <MapPin size={22} strokeWidth={1.8} aria-hidden="true" />
          {/* 좌표 해석이 아직 안 끝난 상태와 "없다"를 구분한다. 확인 중인 것을
              없다고 말하면, 잠시 뒤 지도가 뜨는 화면에서 방금 한 말이 거짓이 된다. */}
          <p className={styles.emptyTitle}>
            {locationReady ? '위치 정보를 확인할 수 없습니다.' : '위치 정보를 확인하고 있습니다…'}
          </p>
          {locationReady && (
            <p className={styles.emptyDesc}>정확한 위치가 확인되면 지도와 로드뷰를 제공합니다.</p>
          )}
        </div>
      ) : (
        <div className={styles.mapFrame} ref={ref}>
          {inView ? (
            <KakaoMapEmbed mode="coordinate" latitude={coords!.lat} longitude={coords!.lng} type={view} />
          ) : (
            // 컨테이너 높이는 위 .mapFrame이 이미 잡고 있어 레이아웃 시프트가 없다.
            <div className={styles.mapLoading}>지도를 불러오는 중…</div>
          )}
        </div>
      )}

      {addressLine ? <p className={styles.address}>{addressLine}</p> : null}
    </section>
  );
}
