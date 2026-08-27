'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  ComposedChart, LineChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { BarChart3, Table2, Lightbulb, MapPin, ChevronDown } from 'lucide-react';
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
}

const RANKING_CONFIGS: Record<string, RankingConfig> = {
  decline: {
    apiType: 'apt',
    filter: (c) => c.pctChange !== null && c.pctChange <= -3,
    sort: (a, b) => (a.pctChange ?? 0) - (b.pctChange ?? 0),
    value: (c) => formatPercentChange(c.pctChange),
    direction: (c) => c.pctChange,
    meta: (c) => `${c.pyung ? `${c.pyung}평 · ` : ''}최근 ${c.latestPrice}`,
    emptyText: '최근 12개월 내 뚜렷한 하락 거래가 없습니다.',
    note: '최근 거래 평균과 과거 거래 평균을 비교한 하락폭입니다(최근 12개월).',
    criterionPhrase: '하락폭이 큰',
  },
  'record-high': {
    apiType: 'apt',
    filter: () => true,
    sort: (a, b) => b.maxDealAmount - a.maxDealAmount,
    value: (c) => c.maxPrice,
    direction: () => null,
    meta: (c) => `${c.maxDate} 거래`,
    emptyText: '표시할 데이터가 없습니다.',
    note: '최근 12개월 내 단지별 최고 거래가 기준입니다(전체 역사상 최고가가 아닙니다).',
    criterionPhrase: '최근 신고가를 기록한',
  },
  rising: {
    apiType: 'apt',
    filter: (c) => c.pctChange !== null && c.pctChange >= 3,
    sort: (a, b) => (b.pctChange ?? 0) - (a.pctChange ?? 0),
    value: (c) => formatPercentChange(c.pctChange),
    direction: (c) => c.pctChange,
    meta: (c) => `${c.pyung ? `${c.pyung}평 · ` : ''}최근 ${c.latestPrice}`,
    emptyText: '최근 12개월 내 뚜렷한 상승 거래가 없습니다.',
    note: '최근 거래 평균과 과거 거래 평균을 비교한 상승폭입니다(최근 12개월).',
    criterionPhrase: '상승폭이 큰',
  },
  'top-traded': {
    apiType: 'apt',
    filter: () => true,
    sort: (a, b) => b.tradeCount - a.tradeCount,
    value: (c) => `${c.tradeCount}건`,
    direction: () => null,
    meta: (c) => `최근 ${c.latestPrice}`,
    emptyText: '표시할 데이터가 없습니다.',
    note: '최근 12개월 매매 거래 건수 기준입니다.',
    criterionPhrase: '최근 거래가 많은',
  },
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
                tradeCount: c.tradeCount,
              }}
            />
          ))}
        </RankingList>
      )}
    </div>
  );
}

type DealType = 'sale' | 'jeonse' | 'wolse';
const DEAL_TYPE_OPTIONS: { key: DealType; label: string; indexLabel: string }[] = [
  { key: 'sale', label: '매매', indexLabel: '매매가격지수' },
  { key: 'jeonse', label: '전세', indexLabel: '전세가격지수' },
  { key: 'wolse', label: '월세', indexLabel: '월세가격지수' },
];

function VolumeView({ lawdCd, sidoCode, displayRegionName }: { lawdCd: string | null; sidoCode: string; displayRegionName: string }) {
  const [chartView, setChartView] = useState<'graph' | 'table'>('graph');
  const [dealType, setDealType] = useState<DealType>('sale');
  const dashboardQuery = lawdCd ? `lawdCd=${lawdCd}` : `sidoCode=${sidoCode}`;
  const { data: apiResponse, isLoading } = useSWR(
    `/api/stats/dashboard?${dashboardQuery}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );
  // STATISTICS REGION FILTER V2 §19/§20/§26 — 연도별(2014~현재) 표는 구 하나도
  // 월 130+회 조회라 이미 무겁다. 시도 전체로 이를 그대로 곱하면(구 수 배)
  // 현재 MOLIT 스로틀 구조로는 안전하게 완주하기 어렵다 — 억지로 부분 결과를
  // "부산 전체"인 것처럼 보여주지 않고 정직하게 미지원 처리한다(§26 완전 집계
  // 또는 honest unsupported).
  const { data: yearlyResponse } = useSWR(
    lawdCd && chartView === 'table' ? `/api/stats/yearly?lawdCd=${lawdCd}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );
  const data = apiResponse?.success ? apiResponse.data : null;
  const chartData = data?.chartDataByType?.[dealType] || data?.chartData || [];
  const yearlyTableByType = yearlyResponse?.success ? yearlyResponse.data.yearlyTableByType : null;
  const yearlyTable = yearlyTableByType?.[dealType] || (yearlyResponse?.success ? yearlyResponse.data.yearlyTable : null);
  const dealTypeMeta = DEAL_TYPE_OPTIONS.find((o) => o.key === dealType)!;

  if (isLoading) return <InlineLoading message="분석 중입니다..." />;
  if (!data) return <ErrorState variant="section" message="거래량 데이터를 불러오지 못했습니다." />;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <SectionHeader title="거래량·시세 추이" />
        <div className={styles.viewToggle}>
          <button className={`${styles.viewToggleBtn} ${chartView === 'graph' ? styles.viewToggleActive : ''}`} onClick={() => setChartView('graph')} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <BarChart3 size={14} aria-hidden="true" />그래프
          </button>
          <button
            className={`${styles.viewToggleBtn} ${chartView === 'table' ? styles.viewToggleActive : ''}`}
            onClick={() => lawdCd && setChartView('table')}
            disabled={!lawdCd}
            title={!lawdCd ? '연도별 표는 시/군/구를 선택하면 볼 수 있어요' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', opacity: lawdCd ? 1 : 0.5 }}
          >
            <Table2 size={14} aria-hidden="true" />표
          </button>
        </div>
      </div>

      <div className={styles.dealTypeChipRow}>
        {DEAL_TYPE_OPTIONS.map((opt) => (
          <FilterChip key={opt.key} active={dealType === opt.key} onClick={() => setDealType(opt.key)}>
            {opt.label}
          </FilterChip>
        ))}
      </div>

      {chartView === 'graph' ? (
        <div className={styles.panelBody} style={{ height: '400px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
              <CartesianGrid stroke="#f5f5f5" vertical={false} />
              <XAxis dataKey="month" scale="band" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} dy={10} />
              <YAxis yAxisId="left" orientation="left" stroke="#94a3b8" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" domain={['auto', 'auto']} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} labelStyle={{ fontWeight: 700, color: '#1e293b', marginBottom: '8px' }} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '13px' }} />
              <Bar yAxisId="left" dataKey="volume" name={`거래량(건) · ${dealTypeMeta.label}`} barSize={16} fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="priceIndex" name={dealTypeMeta.indexLabel} stroke="#3b82f6" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <div className={styles.tipBox}>
            <span><Lightbulb size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.3rem' }} /><strong>분석 팁:</strong> 최근 12개월 실거래 기준, {displayRegionName}의 {dealTypeMeta.label} 거래량과 가격지수(최초 유효월=100 기준) 추이입니다.</span>
          </div>
          <div className={styles.marketGuideCard}>
            <span>
              <Lightbulb size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.3rem' }} /><strong>시장 지표 가이드</strong>: 전세지수 상승 &amp; 매매지수 하락은 실거주 수요 대비 매매 심리가 위축된 상태입니다. 전세가율이 높아짐에 따라 매매가 하방 지지선이 형성되며, 추후 매수 전환 수요 유입 가능성을 나타냅니다.
            </span>
          </div>
        </div>
      ) : (
        <div className={styles.panelBody}>
          <div className={styles.tableWrapper}>
            <table className={styles.yearlyTable}>
              <colgroup>
                <col style={{ width: '18%' }} />
                <col style={{ width: '23%' }} />
                <col style={{ width: '23%' }} />
                <col style={{ width: '23%' }} />
                <col style={{ width: '13%' }} />
              </colgroup>
              <thead><tr><th>거래년월</th><th>최고가</th><th>최저가</th><th>평균가</th><th>건수</th></tr></thead>
              <tbody>
                {!yearlyTable ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`skeleton-${i}`}><td colSpan={5}><div className={styles.skeletonBar} /></td></tr>
                  ))
                ) : (
                  [...yearlyTable].reverse().map((row: any) => (
                    <tr key={row.year}>
                      <td className={styles.yearlyTableYear}>{row.year}년</td>
                      <td>{row.maxPrice || '-'}</td>
                      <td>{row.minPrice || '-'}</td>
                      <td>{row.avgPrice || '-'}</td>
                      <td>{row.count.toLocaleString('ko-KR')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
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
        ) : slug in RANKING_CONFIGS ? (
          <RankingListView slug={slug} lawdCd={region.lawdCd} sidoCode={region.sidoCode} regionLabel={region.displayRegionName} />
        ) : slug === 'volume' ? (
          <VolumeView lawdCd={region.lawdCd} sidoCode={region.sidoCode} displayRegionName={region.displayRegionName} />
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
