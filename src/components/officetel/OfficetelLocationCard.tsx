'use client';

// OFFICETEL_V1 STEP 6 §4/§5/§7/§10/§11 — 오피스텔 상세의 위치 카드.
//
// 좌표는 **STEP 5B에서 검증해 적재한 master 좌표**만 쓴다(§6). 주소 지오코딩, 건물명
// 검색, 키워드 검색, 근처 건물, 첫 번째 결과, 다른 master 좌표, 아파트 좌표 — 어느
// 것도 폴백으로 쓰지 않는다. 좌표가 없으면 지도를 아예 그리지 않는다.
//
// 지도↔로드뷰는 **같은 카드 안에서** 오간다. 페이지를 떠나지 않으므로 거래 탭·면적
// 칩 등 주변 상태는 전혀 건드리지 않는다(§5).
//
// §11 — 지도는 화면에 들어올 때 로드한다. 상세 초기 렌더에 지도 SDK를 끌고 들어오면
// PERFORMANCE V2에서 닫아둔 성능을 되돌리게 된다.
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, Camera, Map as MapIcon } from 'lucide-react';
import { officetelLocationState, toggleLocationView, type LocationView } from '@/lib/kakao/map-embed-logic';
import { useLazyInView } from '@/lib/kakao/use-lazy-in-view';
import styles from './officetel-detail.module.css';

const KakaoMapEmbed = dynamic(() => import('@/components/KakaoMapEmbed'), {
  ssr: false,
  loading: () => <div className={styles.mapLoading}>지도를 불러오는 중…</div>,
});


interface Props {
  coordinates: { latitude: number; longitude: number } | null;
  /** 카드 부제로만 쓴다 — 위치 해석에는 절대 쓰이지 않는다. */
  addressLine: string;
  roadAddress: string | null;
}

export default function OfficetelLocationCard({ coordinates, addressLine, roadAddress }: Props) {
  const state = officetelLocationState(coordinates);
  const [view, setView] = useState<LocationView>('map');
  // APT_DETAIL_INLINE_MAP_ROADVIEW_V1 §18 — 여기 있던 "화면에 들어올 때 한 번만"
  // 판정을 useLazyInView로 옮겼다. 아파트 상세도 같은 판정이 필요해졌는데, 이건
  // IntersectionObserver 단독으로는 안 되는(콜백이 영영 오지 않는) 미묘한 로직이라
  // 두 벌로 두면 한쪽만 고쳐질 수밖에 없다. 동작은 그대로다.
  const { ref: wrapRef, inView } = useLazyInView<HTMLDivElement>({ enabled: state === 'MAP_READY' });

  return (
    <section className={styles.card}>
      <h2 className={styles.sectionTitle}>
        <MapPin size={15} strokeWidth={2.2} aria-hidden /> 위치
      </h2>

      <div className={styles.locationAddress}>
        {roadAddress ? <span>{roadAddress}</span> : null}
        <span className={roadAddress ? styles.locationJibun : undefined}>{addressLine}</span>
      </div>

      {state === 'NO_COORDINATE' ? (
        // §7 — 가짜/빈 지도를 그리지 않는다. 재시도 지오코딩도 없다.
        <div className={styles.locationEmpty}>
          <MapPin size={22} strokeWidth={1.8} aria-hidden />
          <p className={styles.locationEmptyTitle}>위치 정보가 아직 확인되지 않았습니다.</p>
          <p className={styles.locationEmptyDesc}>정확한 위치가 확인되면 지도와 로드뷰를 제공할 예정입니다.</p>
        </div>
      ) : (
        <div className={styles.mapFrame} ref={wrapRef}>
          {inView ? (
            <KakaoMapEmbed
              mode="coordinate"
              latitude={coordinates!.latitude}
              longitude={coordinates!.longitude}
              type={view}
            />
          ) : (
            <div className={styles.mapLoading}>지도를 불러오는 중…</div>
          )}

          <button
            type="button"
            className={styles.mapToggle}
            onClick={() => setView((v) => toggleLocationView(v))}
            aria-label={view === 'map' ? '로드뷰로 전환' : '지도로 전환'}
          >
            {view === 'map' ? (
              <>
                <Camera size={14} strokeWidth={2.2} aria-hidden /> 로드뷰
              </>
            ) : (
              <>
                <MapIcon size={14} strokeWidth={2.2} aria-hidden /> 지도
              </>
            )}
          </button>
        </div>
      )}
    </section>
  );
}
