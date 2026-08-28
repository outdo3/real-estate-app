'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { MapPin, ChevronDown } from 'lucide-react';
import Header from '@/components/Header';
import RegionSelectModal from '@/components/RegionSelectModal';
import ApartmentAutocomplete, { ApartmentSearchResult } from '@/components/ApartmentAutocomplete';
import SectionHeader from '@/components/ui/SectionHeader';
import Empty from '@/components/ui/Empty';
import InlineLoading from '@/components/ui/InlineLoading';
import ShareAction from '@/components/ShareAction';
import { useRegion } from '@/contexts/RegionContext';
import { getStatsMenuItem } from '../statsMenu';
import { buildStatsShareContext, statsRegionShareLabel } from './shareContext';
import TransactionFeedView from '@/components/stats/TransactionFeedView';
import PriceRankingView from '@/components/stats/PriceRankingView';
import Area84RankingView from '@/components/stats/Area84RankingView';
import RegionChangeMapView from '@/components/stats/RegionChangeMapView';
import ConcentrationView from '@/components/stats/ConcentrationView';
import VolumeChartCard from '@/components/stats/VolumeChartCard';
import GapInvestView from '@/components/stats/GapInvestView';
import SupplyView from '@/components/stats/SupplyView';
import LargeComplexView from '@/components/stats/LargeComplexView';
import styles from '../page.module.css';

const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

function ComingSoonCard({ title, reason }: { title: string; reason?: string }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelBody}>
        <Empty
          variant="notReady"
          title={`${title} 데이터는 아직 집계 중입니다.`}
          description={[reason, '임의의 추정치를 보여드리지 않기 위해 실제 데이터가 연동될 때까지 비워둡니다.'].filter(Boolean).join(' ')}
        />
      </div>
    </div>
  );
}

const COMPARE_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

function CompareView({ lawdCd, maxComplexes }: { lawdCd: string | null; maxComplexes: number }) {
  const [selected, setSelected] = useState<{ name: string }[]>([]);
  const [series, setSeries] = useState<Record<string, { date: string; price: number }[]>>({});
  const [loading, setLoading] = useState(false);

  const addComplex = (result: ApartmentSearchResult) => {
    if (selected.length >= maxComplexes) return;
    if (selected.some((s) => s.name === result.name)) return;
    setSelected((prev) => [...prev, { name: result.name }]);
  };
  const removeComplex = (name: string) => {
    setSelected((prev) => prev.filter((s) => s.name !== name));
    setSeries((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  useEffect(() => {
    if (!lawdCd) return;
    const missing = selected.filter((s) => !(s.name in series));
    if (missing.length === 0) return;
    setLoading(true);
    Promise.all(
      missing.map((s) =>
        fetch(`/api/apt/${encodeURIComponent(s.name)}?lawdCd=${lawdCd}&type=apt&period=36`)
          .then((res) => res.json())
          .then((data) => ({
            name: s.name,
            points: (data.trades || [])
              .map((t: any) => ({ date: t.tradeDate, price: t.price }))
              .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()),
          }))
      )
    ).then((results) => {
      setSeries((prev) => {
        const next = { ...prev };
        results.forEach((r) => { next[r.name] = r.points; });
        return next;
      });
      setLoading(false);
    });
  }, [selected, lawdCd, series]);

  // STATISTICS REGION FILTER V2 §26 — 단지 비교는 특정 시/군/구 스코프의 단지
  // 자동완성 검색이 전제라, "시도 전체"에서는 어느 구의 단지를 검색해야 할지
  // 안전하게 정할 수 없다. 모든 hook을 호출한 뒤(Rules of Hooks 준수) 정직하게
  // "구를 선택해주세요"로 안내한다(가짜 부분 지원 금지).
  if (!lawdCd) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelBody}>
          <Empty variant="notReady" title="단지 비교는 시/군/구를 선택하면 이용할 수 있어요." description="현재 시도 전체가 선택돼 있어요. 상단 지역 선택에서 구/군을 골라주세요." />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <SectionHeader title={maxComplexes === 2 ? '단지 2곳 시세 비교' : '여러 단지 시세 비교'} description="최근 3년 · 매매 기준" />
      </div>
      <div>
        {selected.map((s, i) => (
          <div key={s.name} className={styles.compareSlot}>
            <span className={styles.compareColorDot} style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }} />
            <span style={{ flex: 1, fontWeight: 700, fontSize: '0.9rem' }}>{s.name}</span>
            <button className={styles.compareRemoveBtn} onClick={() => removeComplex(s.name)} aria-label="제거">×</button>
          </div>
        ))}
        {selected.length < maxComplexes && (
          <div style={{ padding: '0.75rem 1rem' }}>
            <ApartmentAutocomplete
              key={selected.length}
              onSelect={addComplex}
              placeholder={`비교할 단지 검색 (${selected.length}/${maxComplexes})`}
            />
          </div>
        )}
      </div>
      <div className={styles.panelBody} style={{ height: '360px' }}>
        {selected.length === 0 ? (
          <Empty variant="noData" title={`비교할 단지를 ${maxComplexes === 2 ? '2곳' : '2곳 이상'} 검색해서 추가해주세요.`} showMascot={false} />
        ) : loading ? (
          <InlineLoading message="불러오는 중..." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
              <CartesianGrid stroke="#f5f5f5" vertical={false} />
              <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 12 }} unit="억" />
              <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '13px' }} />
              {selected.map((s, i) => (
                <Line key={s.name} data={series[s.name] || []} dataKey="price" name={s.name} stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]} strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// 5분위(quintile) 색상 — 낮은 평당가(파랑)에서 높은 평당가(빨강)로
const QUINTILE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444'];

function PriceMapView({ lawdCd }: { lawdCd: string | null }) {
  const [isMapReady, setIsMapReady] = useState(false);
  const [markers, setMarkers] = useState<{ id: string; name: string; lat: number; lng: number; pricePerPyung: number; tier: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [KakaoMap, setKakaoMap] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    import('react-kakao-maps-sdk').then((mod) => {
      if (mounted) setKakaoMap({ Map: mod.Map, CustomOverlayMap: mod.CustomOverlayMap });
    });
    return () => { mounted = false; };
  }, []);

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
  }, []);

  useEffect(() => {
    if (!lawdCd) return;
    setLoading(true);
    fetch(`/api/transactions?type=apt&lawdCd=${lawdCd}&months=12`)
      .then((res) => res.json())
      .then((data: any[]) => {
        const byComplex: Record<string, any> = {};
        (Array.isArray(data) ? data : []).forEach((t) => {
          if (!t.lat || !t.lng || !t.pyung || t.pyung <= 0) return;
          const key = `${t.dong}|${t.name}`;
          if (!byComplex[key]) byComplex[key] = t; // 이미 계약일 최신순 정렬되어 내려옴
        });
        const withPrice = Object.entries(byComplex).map(([key, t]: [string, any]) => ({
          id: key,
          name: t.name,
          lat: t.lat,
          lng: t.lng,
          pricePerPyung: Math.round(t.dealAmount / t.pyung),
        }));
        const sorted = [...withPrice].sort((a, b) => a.pricePerPyung - b.pricePerPyung);
        const bucketSize = Math.max(1, Math.ceil(sorted.length / 5));
        const tierByName: Record<string, number> = {};
        sorted.forEach((m, i) => { tierByName[m.id] = Math.min(4, Math.floor(i / bucketSize)); });
        setMarkers(withPrice.map((m) => ({ ...m, tier: tierByName[m.id] ?? 0 })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [lawdCd]);

  // STATISTICS REGION FILTER V2 §26 — 지도 렌더링/분위 계산이 시/군/구 하나를
  // 전제로 설계돼 있어(카카오 지도 center/zoom도 구 단위), 시도 전체에서 "일부
  // 데이터만 보이는" 지도를 정직하지 않게 보여주지 않는다.
  if (!lawdCd) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelBody}>
          <Empty variant="notReady" title="분위지도는 시/군/구를 선택하면 이용할 수 있어요." description="현재 시도 전체가 선택돼 있어요. 상단 지역 선택에서 구/군을 골라주세요." />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <SectionHeader title="평당가 분위 지도" description="최근 12개월 · 5분위 색상(낮음→높음: 파랑-초록-노랑-주황-빨강, 브랜드 그린과 무관한 별도 5단계 배색)" />
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem 1.25rem', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
        {['1분위(낮음)', '2분위', '3분위', '4분위', '5분위(높음)'].map((label, i) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: QUINTILE_COLORS[i], display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>
      <div style={{ height: '500px', position: 'relative' }}>
        {!apiKey || !isMapReady || !KakaoMap ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><InlineLoading message="지도를 불러오는 중입니다..." /></div>
        ) : loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><InlineLoading message="가격 데이터를 분석 중입니다..." /></div>
        ) : markers.length === 0 ? (
          <Empty variant="noData" title="표시할 좌표 데이터가 없습니다." showMascot={false} />
        ) : (
          <KakaoMap.Map
            center={{ lat: markers[0].lat, lng: markers[0].lng }}
            style={{ width: '100%', height: '100%' }}
            level={6}
          >
            {markers.map((m) => (
              <KakaoMap.CustomOverlayMap key={m.id} position={{ lat: m.lat, lng: m.lng }} yAnchor={0.5}>
                <div
                  title={`${m.name} · 평당 ${m.pricePerPyung.toLocaleString('ko-KR')}만원`}
                  style={{
                    width: '14px', height: '14px', borderRadius: '50%',
                    background: QUINTILE_COLORS[m.tier], border: '2px solid white',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                  }}
                />
              </KakaoMap.CustomOverlayMap>
            ))}
          </KakaoMap.Map>
        )}
      </div>
    </div>
  );
}

export default function StatsTypeClient({ slug }: { slug: string }) {
  const { region, setRegion, openRegionModal } = useRegion();
  const searchParams = useSearchParams();
  const item = getStatsMenuItem(slug);

  // GLOBAL SHARE SYSTEM V1 §6/§27 — 통계 지역 필터는 RegionContext(client-only state)에만
  // 있고 URL에는 없다(감사 결과). 공유 링크(buildStatsShareContext가 만든 ?sido=&sigungu=
  // 등)로 들어온 경우 최초 진입 시 한 번 RegionContext에 반영해, 받은 사람이 보낸 사람과
  // 같은 지역을 보게 한다. RegionContext 자체의 GPS/기본값 로직은 건드리지 않는다 — 이
  // 화면에 도착했을 때만 URL 값이 있으면 우선 적용한다.
  useEffect(() => {
    const sido = searchParams.get('sido');
    const sidoCode = searchParams.get('sidoCode');
    if (!sido || !sidoCode) return;
    const sigungu = searchParams.get('sigungu') || '';
    const dong = searchParams.get('dong') || 'all';
    const lawdCd = searchParams.get('lawdCd');
    const displayRegionName =
      dong !== 'all' ? dong : sigungu ? `${sido} ${sigungu} 동 전체` : `${sido} 전체`;
    setRegion({ lawdCd: lawdCd || null, sidoCode, dong, sido, sigungu, displayRegionName });
  }, []);

  if (!item) return null;

  const shareContext = buildStatsShareContext(item, region);

  return (
    <div className={styles.main}>
      {/* [STATISTICS V2 §12] 상세 화면 헤더에는 emoji를 더 이상 붙이지 않는다
          (STATS_MENU.icon은 landing 그리드의 Lucide 매핑 키로만 남음, §35). */}
      <Header pageTitle={item.title} />
      <div className="container">
        {/* REGION_PRICE_CHANGE_MAP_V2 — 이 화면은 전역 RegionContext가 표현할 수
            없는 대한민국 전체/단지 레벨까지 다루는 자체 drill-down 상태(URL
            기반)를 쓰고, breadcrumb+공유 버튼을 직접 렌더링한다(§22/§23) —
            공통 지역 트리거/공유 바는 중복이라 생략한다. */}
        {slug !== 'change-map' && (
          <div className={styles.headerTop}>
            <button className={styles.regionTrigger} onClick={openRegionModal}>
              <MapPin size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.3rem' }} />
              <span>{region.displayRegionName}</span>
              <ChevronDown size={14} aria-hidden="true" className={styles.regionTriggerCaret} />
            </button>
            {item.status === 'live' && (
              <ShareAction title={shareContext.title} text={shareContext.text} params={shareContext.params} />
            )}
          </div>
        )}

        {item.status === 'soon' ? (
          <ComingSoonCard title={item.title} reason={item.soonReason} />
        ) : slug === 'feed' ? (
          <TransactionFeedView lawdCd={region.lawdCd} sidoCode={region.sidoCode} dong={region.dong} displayRegionName={region.displayRegionName} />
        ) : slug === 'decline' || slug === 'record-high' || slug === 'rising' || slug === 'jeonse-risk' ? (
          <PriceRankingView mode={slug} lawdCd={region.lawdCd} sidoCode={region.sidoCode} dong={region.dong} displayRegionName={region.displayRegionName} />
        ) : slug === 'area84' ? (
          <Area84RankingView
            lawdCd={region.lawdCd}
            sidoCode={region.sidoCode}
            dong={region.dong}
            displayRegionName={region.displayRegionName}
            regionQuestionLabel={`${statsRegionShareLabel(region)}에서 84㎡가 비싼 단지는?`}
          />
        ) : slug === 'change-map' ? (
          <RegionChangeMapView />
        ) : slug === 'top-traded' ? (
          <ConcentrationView lawdCd={region.lawdCd} sidoCode={region.sidoCode} dong={region.dong} displayRegionName={region.displayRegionName} />
        ) : slug === 'volume' ? (
          <VolumeChartCard lawdCd={region.lawdCd} sidoCode={region.sidoCode} displayRegionName={region.displayRegionName} />
        ) : slug === 'gap-invest' ? (
          <GapInvestView lawdCd={region.lawdCd} sidoCode={region.sidoCode} dong={region.dong} displayRegionName={region.displayRegionName} />
        ) : slug === 'supply' ? (
          <SupplyView />
        ) : slug === 'large-complex' ? (
          <LargeComplexView lawdCd={region.lawdCd} sidoCode={region.sidoCode} dong={region.dong} displayRegionName={region.displayRegionName} />
        ) : slug === 'compare' ? (
          <CompareView lawdCd={region.lawdCd} maxComplexes={2} />
        ) : slug === 'multi-compare' ? (
          <CompareView lawdCd={region.lawdCd} maxComplexes={5} />
        ) : slug === 'price-map' ? (
          <PriceMapView lawdCd={region.lawdCd} />
        ) : null}
      </div>
      <RegionSelectModal />
    </div>
  );
}
