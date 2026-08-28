'use client';

import React, { useEffect, useState } from 'react';
import useSWR from 'swr';
import Empty from '@/components/ui/Empty';
import ErrorState from '@/components/ui/ErrorState';
import InlineLoading from '@/components/ui/InlineLoading';
import { useRegion } from '@/contexts/RegionContext';
import styles from './SupplyView.module.css';

// STATISTICS V2.1-4 — SUPPLY(공급). §7/§14 입주지도 + 공급추이 두 탭. Presale에는
// lawdCd가 없어(§5) RegionContext의 sido(전체 이름)/sigungu(축약형)를 그대로 서버에
// 전달해 안전하게 문자열 매칭한다(§presale-region.ts). "전국"은 RegionContext를 바꾸지
// 않는 이 화면 전용 로컬 토글이다(다른 8개 live 화면에 영향 없음).

const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

interface SupplyResponse {
  status: 'OK' | 'ERROR';
  message?: string;
  scope: { sido: string | null; sigungu: string | null; nationwide: boolean };
  period: { preset: string; from: string; to: string | null };
  summary: { totalCount: number; mapCount: number };
  mapMarkers: { id: number; name: string; moveInExpectedYm: string; totalSupplyHouseholds: number | null; lat: number; lng: number; scale: 'small' | 'medium' | 'large' | 'unknown'; locationAddress: string | null }[];
  list: { id: number; name: string; moveInExpectedYm: string; totalSupplyHouseholds: number | null; hasCoords: boolean; locationAddress: string | null; pblancUrl: string | null }[];
  trend: { year: string; projectCount: number; householdSum: number }[];
  interpretation: string[];
  sort: string;
  source: string;
}

const PERIOD_OPTIONS = [
  { value: 'y1', label: '향후 1년' },
  { value: 'y2', label: '향후 2년' },
  { value: 'y3', label: '향후 3년' },
  { value: 'all', label: '전체 예정' },
];

const SCALE_META: Record<string, { label: string; color: string; size: number }> = {
  small: { label: '300세대 미만', color: '#94a3b8', size: 10 },
  medium: { label: '300~999세대', color: '#3b82f6', size: 14 },
  large: { label: '1,000세대 이상', color: '#16a34a', size: 18 },
  unknown: { label: '세대수 미확인', color: '#cbd5e1', size: 8 },
};

function ym(v: string): string {
  if (!v || v.length !== 6) return v;
  return `${v.slice(0, 4)}.${v.slice(4, 6)}`;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function SupplyView() {
  const { region } = useRegion();
  const [tab, setTab] = useState<'map' | 'trend'>('map');
  const [nationwide, setNationwide] = useState(false);
  const [period, setPeriod] = useState('y2');
  const [selectedMarkerId, setSelectedMarkerId] = useState<number | null>(null);

  const [isMapReady, setIsMapReady] = useState(false);
  const [KakaoMap, setKakaoMap] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    import('react-kakao-maps-sdk').then((mod) => {
      if (mounted) setKakaoMap({ Map: mod.Map, CustomOverlayMap: mod.CustomOverlayMap });
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!apiKey || tab !== 'map') return;
    const scriptId = 'kakao-map-script-main';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer&autoload=false`;
      script.async = true;
      document.head.appendChild(script);
    }
    const check = setInterval(() => {
      if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
        clearInterval(check);
        setIsMapReady(true);
      } else if (window.kakao && window.kakao.maps) {
        clearInterval(check);
        window.kakao.maps.load(() => setIsMapReady(true));
      }
    }, 200);
    return () => clearInterval(check);
  }, [tab]);

  const params = new URLSearchParams({ period });
  if (!nationwide) {
    params.set('sido', region.sido);
    if (region.lawdCd && region.sigungu) params.set('sigungu', region.sigungu);
  }

  const { data, isLoading } = useSWR<SupplyResponse>(`/api/stats/supply?${params.toString()}`, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60 * 1000,
  });

  const scopeLabel = nationwide ? '전국' : region.lawdCd && region.sigungu ? `${region.sido} ${region.sigungu}` : region.sido;
  const selectedMarker = data?.mapMarkers.find((m) => m.id === selectedMarkerId) || null;
  const maxHouseholdSum = data ? Math.max(1, ...data.trend.map((t) => t.householdSum)) : 1;

  return (
    <div className={styles.wrap}>
      <div className={styles.tabRow}>
        <button className={`${styles.tab} ${tab === 'map' ? styles.tabActive : ''}`} onClick={() => setTab('map')}>입주지도</button>
        <button className={`${styles.tab} ${tab === 'trend' ? styles.tabActive : ''}`} onClick={() => setTab('trend')}>공급추이</button>
      </div>

      <div className={styles.chipRow}>
        <button className={`${styles.chip} ${!nationwide ? styles.chipActive : ''}`} onClick={() => setNationwide(false)}>{region.sido || '지역'}</button>
        <button className={`${styles.chip} ${nationwide ? styles.chipActive : ''}`} onClick={() => setNationwide(true)}>전국</button>
      </div>
      <div className={styles.chipRow}>
        {PERIOD_OPTIONS.map((p) => (
          <button key={p.value} className={`${styles.chip} ${period === p.value ? styles.chipActive : ''}`} onClick={() => setPeriod(p.value)}>{p.label}</button>
        ))}
      </div>

      {isLoading ? (
        <InlineLoading message="공급 데이터를 불러오는 중입니다..." />
      ) : data?.status === 'ERROR' ? (
        <ErrorState variant="section" message={data.message || '공급 데이터를 불러오지 못했어요.'} />
      ) : !data || data.summary.totalCount === 0 ? (
        <Empty variant="noData" title="선택한 지역/기간에 확인된 입주예정 단지가 없어요." showMascot={false} />
      ) : tab === 'map' ? (
        <>
          <div className={styles.summaryCard}>
            <div className={styles.summaryTitle}>{scopeLabel} · {PERIOD_OPTIONS.find((p) => p.value === period)?.label}</div>
            <div className={styles.summaryText}>
              전체 입주예정 단지 <strong>{data.summary.totalCount.toLocaleString('ko-KR')}개</strong> 중 위치 확인 <strong>{data.summary.mapCount.toLocaleString('ko-KR')}개</strong>
            </div>
            <div className={styles.honestNote}>지도에는 위치정보가 확인된 단지만 표시됩니다. 나머지는 아래 목록에서 확인할 수 있어요.</div>
          </div>

          <div className={styles.legendRow}>
            {(['small', 'medium', 'large'] as const).map((s) => (
              <span key={s} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: SCALE_META[s].color, width: SCALE_META[s].size, height: SCALE_META[s].size }} />
                {SCALE_META[s].label}
              </span>
            ))}
          </div>

          <div className={styles.mapBox}>
            {!apiKey || !isMapReady || !KakaoMap ? (
              <InlineLoading message="지도를 불러오는 중입니다..." />
            ) : data.mapMarkers.length === 0 ? (
              <Empty variant="noData" title="위치가 확인된 단지가 없어요." description="아래 목록에서 전체 단지를 볼 수 있어요." showMascot={false} />
            ) : (
              <KakaoMap.Map center={{ lat: data.mapMarkers[0].lat, lng: data.mapMarkers[0].lng }} style={{ width: '100%', height: '100%' }} level={nationwide ? 13 : 8}>
                {data.mapMarkers.map((m) => (
                  <KakaoMap.CustomOverlayMap key={m.id} position={{ lat: m.lat, lng: m.lng }} yAnchor={0.5}>
                    <button
                      aria-label={`${m.name} 입주예정 단지`}
                      onClick={() => setSelectedMarkerId(m.id)}
                      style={{
                        width: SCALE_META[m.scale].size, height: SCALE_META[m.scale].size, borderRadius: '50%',
                        background: SCALE_META[m.scale].color, border: '2px solid white',
                        boxShadow: selectedMarkerId === m.id ? '0 0 0 3px rgba(22,163,74,0.4)' : '0 1px 4px rgba(0,0,0,0.3)',
                        padding: 0, cursor: 'pointer',
                      }}
                    />
                  </KakaoMap.CustomOverlayMap>
                ))}
              </KakaoMap.Map>
            )}
          </div>

          {selectedMarker && (
            <div className={styles.markerCard}>
              <div className={styles.markerName}>{selectedMarker.name}</div>
              <div className={styles.markerMeta}>{selectedMarker.locationAddress}</div>
              <div className={styles.markerStat}>
                {ym(selectedMarker.moveInExpectedYm)} 입주예정 · {selectedMarker.totalSupplyHouseholds?.toLocaleString('ko-KR')}세대
              </div>
            </div>
          )}

          <div className={styles.listTitle}>입주예정 목록(위치 미확인 단지 포함) · 입주예정 빠른순</div>
          <ul className={styles.list}>
            {data.list.map((item) => (
              <li key={item.id} className={styles.listRow}>
                <div className={styles.listRowMain}>
                  <span className={styles.listName}>{item.name}</span>
                  <span className={styles.listMeta}>{item.locationAddress}{!item.hasCoords && ' · 위치 미확인'}</span>
                </div>
                <div className={styles.listRowRight}>
                  <span className={styles.listYm}>{ym(item.moveInExpectedYm)}</span>
                  <span className={styles.listHouseholds}>{item.totalSupplyHouseholds?.toLocaleString('ko-KR')}세대</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className={styles.summaryCard}>
            <div className={styles.summaryTitle}>{scopeLabel} · 연도별 입주예정 물량</div>
            {data.interpretation.map((line, i) => (
              <div key={i} className={styles.summaryText}>{line}</div>
            ))}
          </div>

          <div className={styles.trendChart}>
            {data.trend.map((t) => (
              <div key={t.year} className={styles.trendCol}>
                <div className={styles.trendBarWrap}>
                  <div className={styles.trendBar} style={{ height: `${Math.max(4, (t.householdSum / maxHouseholdSum) * 140)}px` }} title={`${t.year}년: ${t.projectCount}개 단지 · ${t.householdSum.toLocaleString('ko-KR')}세대`} />
                </div>
                <div className={styles.trendYear}>{t.year}</div>
                <div className={styles.trendValue}>{t.householdSum.toLocaleString('ko-KR')}</div>
              </div>
            ))}
          </div>

          <ul className={styles.trendTable}>
            {data.trend.map((t) => (
              <li key={t.year} className={styles.trendTableRow}>
                <span>{t.year}년</span>
                <span>{t.projectCount}개 단지 · {t.householdSum.toLocaleString('ko-KR')}세대</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && <div className={styles.sourceNote}>{data.source}</div>}
    </div>
  );
}
