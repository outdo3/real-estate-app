'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { MapPin, ChevronDown } from 'lucide-react';
import Header from '@/components/Header';
import RegionSelectModal from '@/components/RegionSelectModal';
import ApartmentAutocomplete, { ApartmentSearchResult } from '@/components/ApartmentAutocomplete';
import SectionHeader from '@/components/ui/SectionHeader';
import ErrorState from '@/components/ui/ErrorState';
import Empty from '@/components/ui/Empty';
import { RankingList } from '@/components/ui/RankingRow';
import RankingRow from '@/components/ui/RankingRow';
import FilterChip from '@/components/ui/FilterChip';
import InlineLoading from '@/components/ui/InlineLoading';
import { formatPercentChange } from '@/lib/stats-format';
import { buildRankingInsight } from '@/lib/stats-insight';
import { useRegion } from '@/contexts/RegionContext';
import { getStatsMenuItem } from '../statsMenu';
import TransactionFeedView from '@/components/stats/TransactionFeedView';
import PriceRankingView from '@/components/stats/PriceRankingView';
import ConcentrationView from '@/components/stats/ConcentrationView';
import VolumeChartCard from '@/components/stats/VolumeChartCard';
import styles from '../page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

// ── 순위 리스트류(하락/최고가/상승/많이산단지/역전세) 공통 설정 ──
interface RankingComplex {
  name: string;
  dong: string;
  lawdCd: string | null;
  pyung: number | null;
  tradeCount: number;
  latestPrice: string;
  latestDealAmount: number;
  latestDate: string;
  maxPrice: string;
  maxDealAmount: number;
  maxDate: string;
  pctChange: number | null;
}

interface RankingConfig {
  apiType: 'apt' | 'rent';
  filter: (c: RankingComplex) => boolean;
  sort: (a: RankingComplex, b: RankingComplex) => number;
  value: (c: RankingComplex) => string;
  /** 색상 방향 판단용(위 value와 별개) — null이면 방향성 없는 중립 지표(최고가/거래량). */
  direction: (c: RankingComplex) => number | null;
  meta: (c: RankingComplex) => string;
  emptyText: string;
  note: string;
  /** [§27/§44] "이 화면을 보고 어떤 결정을 할 수 있는가"의 근거가 되는 순위
      기준 구(조사 없이) — buildRankingInsight()가 그대로 조립해 쓴다. */
  criterionPhrase: string;
  /** [STATISTICS_COLOR_SYSTEM_V1] direction이 null(값 자체에 부호가 없는
   * 화면 — 신고가/인기단지)일 때 값 텍스트에 쓸 고정 의미색. 지정하지 않으면
   * 기존처럼 direction 부호를 따른다(하락/상승/역전세는 그대로 유지). */
  valueColor?: string;
}

// STATISTICS V2.1-1 — decline/record-high/rising은 PriceRankingView(별도
// 컴포넌트, same-aptSeq+same-raw-area 히스토리 기반 정밀 계산)로 이전했다.
// STATISTICS V2.1-2 — top-traded("인기", 월 단위 tradeCount 랭킹)는 실제로는
// 사용자 행동 popularity가 아니라 순수 거래건수였다는 감사 결과에 따라
// ConcentrationView(day-precise 기간 + 직전 기간 대비 증감, 전용
// /api/stats/concentration)로 교체했다(§2/§19/§23) — 아래 dispatcher 참고.
// jeonse-risk는 이번 STEP 범위 밖이라 기존 RANKING_CONFIGS/RankingListView
// 경로를 그대로 유지한다(회귀 방지, 중복 재구현 없음).
const RANKING_CONFIGS: Record<string, RankingConfig> = {
  'jeonse-risk': {
    apiType: 'rent',
    filter: (c) => c.pctChange !== null && c.pctChange <= -3,
    sort: (a, b) => (a.pctChange ?? 0) - (b.pctChange ?? 0),
    value: (c) => formatPercentChange(c.pctChange),
    direction: (c) => c.pctChange,
    meta: (c) => `${c.pyung ? `${c.pyung}평 · ` : ''}최근 전세 ${c.latestPrice}`,
    emptyText: '최근 12개월 내 전세가 하락 조짐이 뚜렷한 단지가 없습니다.',
    note: '최근 전세 거래 평균이 과거 대비 하락한 단지입니다. 실제 역전세 위험은 집주인의 매입가·대출 상황에 따라 다르니 참고용으로만 활용하세요.',
    criterionPhrase: '전세가 하락 조짐이 있는',
  },
};

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

function RankingListView({ slug, lawdCd, sidoCode, regionLabel }: { slug: string; lawdCd: string | null; sidoCode: string; regionLabel: string }) {
  const router = useRouter();
  const config = RANKING_CONFIGS[slug];
  const query = lawdCd ? `lawdCd=${lawdCd}` : `sidoCode=${sidoCode}`;
  const { data: apiResponse, isLoading } = useSWR(
    `/api/stats/rankings?${query}&type=${config.apiType}&months=12`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );

  const list = useMemo(() => {
    const complexes: RankingComplex[] = apiResponse?.success ? apiResponse.data.complexes : [];
    return complexes.filter(config.filter).sort(config.sort).slice(0, 30);
  }, [apiResponse, config]);

  // [STATISTICS V2 §5/§27] deterministic 한 줄 요약 — 실제 filter 결과에서만 조립.
  const insight = useMemo(
    () => buildRankingInsight({
      regionLabel,
      criterionPhrase: config.criterionPhrase,
      items: list.map((c) => ({ name: c.name, valueLabel: config.value(c), tradeCount: c.tradeCount })),
    }),
    [list, config, regionLabel]
  );

  if (isLoading) {
    return <InlineLoading message="분석 중입니다..." />;
  }
  if (apiResponse && !apiResponse.success) {
    return <ErrorState variant="section" message={apiResponse.error} />;
  }

  return (
    <div className={styles.panel}>
      {/* [STATISTICS_COLOR_SYSTEM_V1] 역전세 = 위험/주의 의미색(주황). 개별
          거래 하락률 값 자체는 여전히 기존 규칙대로 파란색(하락)을 유지하고
          (metricDirection 부호 기반, 변경 없음), 화면 전체가 "위험 신호"라는
          것만 이 배지로 구분한다 — 계산 로직/색 규칙 충돌 없이 카테고리
          의미와 값 부호 의미를 분리했다. */}
      {slug === 'jeonse-risk' && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.6rem', borderRadius: '999px', background: 'var(--warn-soft)', color: 'var(--warning-color)', fontSize: '0.72rem', fontWeight: 700, marginBottom: '0.6rem' }}>
          주의 · 하락 위험 신호
        </div>
      )}
      <div className={styles.panelHeader}>
        {/* [§40 visual hierarchy] 판단 문장(insight)을 방법론 설명(note)보다
            우선 노출 — "숫자 나열"이 아니라 "판단"이 1순위가 되도록. */}
        <SectionHeader title={insight || config.note} description={insight ? config.note : undefined} />
      </div>
      {list.length === 0 ? (
        <Empty variant="noResult" title={config.emptyText} />
      ) : (
        <RankingList>
          {list.map((c, i) => (
            <RankingRow
              key={`${c.dong}-${c.name}`}
              onClick={() => router.push(`/apt/${encodeURIComponent(c.name)}?lawdCd=${c.lawdCd || lawdCd || ''}&dong=${encodeURIComponent(c.dong)}`)}
              data={{
                rank: i + 1,
                name: c.name,
                contextLabel: config.meta(c),
                metricLabel: config.value(c),
                metricDirection: config.direction(c),
                valueColor: config.valueColor,
                tradeCount: c.tradeCount,
              }}
            />
          ))}
        </RankingList>
      )}
    </div>
  );
}

function GapInvestView({ lawdCd, sidoCode }: { lawdCd: string | null; sidoCode: string }) {
  const router = useRouter();
  const query = lawdCd ? `lawdCd=${lawdCd}` : `sidoCode=${sidoCode}`;
  const { data: apiResponse, isLoading } = useSWR(
    `/api/stats/dashboard?${query}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );
  const data = apiResponse?.success ? apiResponse.data : null;

  if (isLoading) return <InlineLoading message="분석 중입니다..." />;
  if (!data) return <ErrorState variant="section" message="갭투자 데이터를 불러오지 못했습니다." />;

  const list = data.gapInvest || [];
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <SectionHeader
          title="소액 갭투자 단지 TOP 5"
          description="최근 3개월 · 동일 전용면적의 최근 매매·전세 거래 기준. 두 거래의 계약 시점(날짜)은 다를 수 있어 참고용으로 활용하세요."
        />
      </div>
      {list.length === 0 ? (
        <Empty variant="noResult" title="최근 3개월 내 매매·전세가 함께 확인된 단지가 없습니다." />
      ) : (
        <RankingList>
          {list.map((item: any) => (
            <RankingRow
              key={item.rank}
              onClick={() => router.push(`/apt/${encodeURIComponent(item.name)}?lawdCd=${item.lawdCd || lawdCd || ''}&dong=${encodeURIComponent(item.dong || '')}`)}
              data={{
                rank: item.rank,
                name: item.name,
                contextLabel: item.pyung ? `${item.pyung}평` : undefined,
                metricLabel: item.gap,
                metricDirection: null,
                tradeCount: item.dealCount,
              }}
            />
          ))}
        </RankingList>
      )}
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
  const { region, openRegionModal } = useRegion();
  const item = getStatsMenuItem(slug);
  if (!item) return null;

  return (
    <div className={styles.main}>
      {/* [STATISTICS V2 §12] 상세 화면 헤더에는 emoji를 더 이상 붙이지 않는다
          (STATS_MENU.icon은 landing 그리드의 Lucide 매핑 키로만 남음, §35). */}
      <Header pageTitle={item.title} />
      <div className="container">
        <div className={styles.headerTop}>
          <button className={styles.regionTrigger} onClick={openRegionModal}>
            <MapPin size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.3rem' }} />
            <span>{region.displayRegionName}</span>
            <ChevronDown size={14} aria-hidden="true" className={styles.regionTriggerCaret} />
          </button>
        </div>

        {item.status === 'soon' ? (
          <ComingSoonCard title={item.title} reason={item.soonReason} />
        ) : slug === 'feed' ? (
          <TransactionFeedView lawdCd={region.lawdCd} sidoCode={region.sidoCode} dong={region.dong} displayRegionName={region.displayRegionName} />
        ) : slug === 'decline' || slug === 'record-high' || slug === 'rising' ? (
          <PriceRankingView mode={slug} lawdCd={region.lawdCd} sidoCode={region.sidoCode} dong={region.dong} displayRegionName={region.displayRegionName} />
        ) : slug === 'top-traded' ? (
          <ConcentrationView lawdCd={region.lawdCd} sidoCode={region.sidoCode} dong={region.dong} displayRegionName={region.displayRegionName} />
        ) : slug in RANKING_CONFIGS ? (
          <RankingListView slug={slug} lawdCd={region.lawdCd} sidoCode={region.sidoCode} regionLabel={region.displayRegionName} />
        ) : slug === 'volume' ? (
          <VolumeChartCard lawdCd={region.lawdCd} sidoCode={region.sidoCode} displayRegionName={region.displayRegionName} />
        ) : slug === 'gap-invest' ? (
          <GapInvestView lawdCd={region.lawdCd} sidoCode={region.sidoCode} />
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
