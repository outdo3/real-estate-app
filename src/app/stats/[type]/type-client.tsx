'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  ComposedChart, LineChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import Header from '@/components/Header';
import RegionSelectModal from '@/components/RegionSelectModal';
import ApartmentAutocomplete, { ApartmentSearchResult } from '@/components/ApartmentAutocomplete';
import { useRegion } from '@/contexts/RegionContext';
import { getStatsMenuItem } from '../statsMenu';
import styles from '../page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

// ── 순위 리스트류(하락/최고가/상승/많이산단지/역전세) 공통 설정 ──
interface RankingComplex {
  name: string;
  dong: string;
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
  valueColor?: string;
  meta: (c: RankingComplex) => string;
  emptyText: string;
  note: string;
}

const RANKING_CONFIGS: Record<string, RankingConfig> = {
  decline: {
    apiType: 'apt',
    filter: (c) => c.pctChange !== null && c.pctChange <= -3,
    sort: (a, b) => (a.pctChange ?? 0) - (b.pctChange ?? 0),
    value: (c) => `${c.pctChange}%`,
    valueColor: '#3b82f6',
    meta: (c) => `${c.pyung ? `${c.pyung}평 · ` : ''}최근 ${c.latestPrice}`,
    emptyText: '최근 12개월 내 뚜렷한 하락 거래가 없습니다.',
    note: '최근 거래 평균과 과거 거래 평균을 비교한 하락폭입니다(최근 12개월).',
  },
  'record-high': {
    apiType: 'apt',
    filter: () => true,
    sort: (a, b) => b.maxDealAmount - a.maxDealAmount,
    value: (c) => c.maxPrice,
    meta: (c) => `${c.maxDate} 거래`,
    emptyText: '표시할 데이터가 없습니다.',
    note: '최근 12개월 내 단지별 최고 거래가 기준입니다(전체 역사상 최고가가 아닙니다).',
  },
  rising: {
    apiType: 'apt',
    filter: (c) => c.pctChange !== null && c.pctChange >= 3,
    sort: (a, b) => (b.pctChange ?? 0) - (a.pctChange ?? 0),
    value: (c) => `+${c.pctChange}%`,
    valueColor: '#ef4444',
    meta: (c) => `${c.pyung ? `${c.pyung}평 · ` : ''}최근 ${c.latestPrice}`,
    emptyText: '최근 12개월 내 뚜렷한 상승 거래가 없습니다.',
    note: '최근 거래 평균과 과거 거래 평균을 비교한 상승폭입니다(최근 12개월).',
  },
  'top-traded': {
    apiType: 'apt',
    filter: () => true,
    sort: (a, b) => b.tradeCount - a.tradeCount,
    value: (c) => `${c.tradeCount}건`,
    meta: (c) => `최근 ${c.latestPrice}`,
    emptyText: '표시할 데이터가 없습니다.',
    note: '최근 12개월 매매 거래 건수 기준입니다.',
  },
  'jeonse-risk': {
    apiType: 'rent',
    filter: (c) => c.pctChange !== null && c.pctChange <= -3,
    sort: (a, b) => (a.pctChange ?? 0) - (b.pctChange ?? 0),
    value: (c) => `${c.pctChange}%`,
    valueColor: '#3b82f6',
    meta: (c) => `${c.pyung ? `${c.pyung}평 · ` : ''}최근 전세 ${c.latestPrice}`,
    emptyText: '최근 12개월 내 전세가 하락 조짐이 뚜렷한 단지가 없습니다.',
    note: '최근 전세 거래 평균이 과거 대비 하락한 단지입니다. 실제 역전세 위험은 집주인의 매입가·대출 상황에 따라 다르니 참고용으로만 활용하세요.',
  },
};

function ComingSoonCard({ title, reason }: { title: string; reason?: string }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelBody}>
        <div className={styles.emptyState}>
          📦 <b>{title}</b> 데이터는 아직 집계 중입니다.
          {reason && <div style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>{reason}</div>}
          <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            임의의 추정치를 보여드리지 않기 위해 실제 데이터가 연동될 때까지 비워둡니다.
          </div>
        </div>
      </div>
    </div>
  );
}

function RankingListView({ slug, lawdCd }: { slug: string; lawdCd: string }) {
  const router = useRouter();
  const config = RANKING_CONFIGS[slug];
  const { data: apiResponse, isLoading } = useSWR(
    lawdCd ? `/api/stats/rankings?lawdCd=${lawdCd}&type=${config.apiType}&months=12` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );

  const list = useMemo(() => {
    const complexes: RankingComplex[] = apiResponse?.success ? apiResponse.data.complexes : [];
    return complexes.filter(config.filter).sort(config.sort).slice(0, 30);
  }, [apiResponse, config]);

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>분석 중입니다...</div>;
  }
  if (apiResponse && !apiResponse.success) {
    return <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>⚠️ {apiResponse.error}</div>;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{config.note}</span>
      </div>
      {list.length === 0 ? (
        <div className={styles.emptyState}>{config.emptyText}</div>
      ) : (
        <ul className={styles.compactList}>
          {list.map((c, i) => (
            <li
              key={`${c.dong}-${c.name}`}
              className={styles.compactItem}
              onClick={() => router.push(`/apt/${encodeURIComponent(c.name)}?lawdCd=${lawdCd}`)}
              role="button"
              tabIndex={0}
            >
              <div className={`${styles.compactRank} ${i === 0 ? styles.rankBadgeTop1 : i === 1 ? styles.rankBadgeTop2 : i === 2 ? styles.rankBadgeTop3 : ''}`}>
                {i + 1}
              </div>
              <div className={styles.compactInfo}>
                <div className={styles.compactName}>{c.name}</div>
                <div className={styles.compactMeta}>{config.meta(c)}</div>
              </div>
              <div className={styles.compactValue}>
                <div className={styles.compactPrice} style={config.valueColor ? { color: config.valueColor } : undefined}>
                  {config.value(c)}
                </div>
                <div className={styles.compactSub}>거래 {c.tradeCount}건</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VolumeView({ lawdCd, displayRegionName }: { lawdCd: string; displayRegionName: string }) {
  const [chartView, setChartView] = useState<'graph' | 'table'>('graph');
  const { data: apiResponse, isLoading } = useSWR(
    lawdCd ? `/api/stats/dashboard?lawdCd=${lawdCd}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );
  const { data: yearlyResponse, isLoading: yearlyLoading } = useSWR(
    lawdCd && chartView === 'table' ? `/api/stats/yearly?lawdCd=${lawdCd}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );
  const data = apiResponse?.success ? apiResponse.data : null;
  const yearlyTable = yearlyResponse?.success ? yearlyResponse.data.yearlyTable : null;

  if (isLoading) return <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>분석 중입니다...</div>;
  if (!data) return <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>⚠️ 거래량 데이터를 불러오지 못했습니다.</div>;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>📊 거래량·시세 추이</h2>
        <div className={styles.viewToggle}>
          <button className={`${styles.viewToggleBtn} ${chartView === 'graph' ? styles.viewToggleActive : ''}`} onClick={() => setChartView('graph')}>{'📊 그래프\n보기'}</button>
          <button className={`${styles.viewToggleBtn} ${chartView === 'table' ? styles.viewToggleActive : ''}`} onClick={() => setChartView('table')}>{'📋 표로\n보기'}</button>
        </div>
      </div>
      {chartView === 'graph' ? (
        <div className={styles.panelBody} style={{ height: '400px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.chartData} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
              <CartesianGrid stroke="#f5f5f5" vertical={false} />
              <XAxis dataKey="month" scale="band" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} dy={10} />
              <YAxis yAxisId="left" orientation="left" stroke="#94a3b8" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" domain={['auto', 'auto']} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} labelStyle={{ fontWeight: 700, color: '#1e293b', marginBottom: '8px' }} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '13px' }} />
              <Bar yAxisId="left" dataKey="volume" name="거래량(건)" barSize={16} fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="saleIndex" name="매매가격지수" stroke="#3b82f6" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls />
              <Line yAxisId="right" type="monotone" dataKey="jeonseIndex" name="전세가격지수" stroke="#10b981" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <div className={styles.tipBox}>
            <span>💡 <strong>분석 팁:</strong> 최근 12개월 실거래 기준, {displayRegionName}의 거래량과 매매/전세 가격지수(최초 유효월=100 기준) 추이입니다.</span>
          </div>
        </div>
      ) : (
        <div className={styles.panelBody}>
          <div className={styles.tableWrapper}>
            <table className={styles.yearlyTable}>
              <thead><tr><th>거래년월</th><th>최고가</th><th>최저가</th><th>평균가</th><th>거래량(건)</th></tr></thead>
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

function GapInvestView({ lawdCd }: { lawdCd: string }) {
  const router = useRouter();
  const { data: apiResponse, isLoading } = useSWR(
    lawdCd ? `/api/stats/dashboard?lawdCd=${lawdCd}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );
  const data = apiResponse?.success ? apiResponse.data : null;

  if (isLoading) return <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>분석 중입니다...</div>;
  if (!data) return <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>⚠️ 갭투자 데이터를 불러오지 못했습니다.</div>;

  const list = data.gapInvest || [];
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>💰 소액 갭투자 단지 TOP 5</h2>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최근 3개월 · 매매-전세 근사 갭</span>
      </div>
      {list.length === 0 ? (
        <div className={styles.emptyState}>최근 3개월 내 매매·전세가 함께 확인된 단지가 없습니다.</div>
      ) : (
        <ul className={styles.compactList}>
          {list.map((item: any) => (
            <li key={item.rank} className={styles.compactItem} onClick={() => router.push(`/apt/${encodeURIComponent(item.name)}?lawdCd=${lawdCd}`)} role="button" tabIndex={0}>
              <div className={`${styles.compactRank} ${item.rank === 1 ? styles.rankBadgeTop1 : item.rank === 2 ? styles.rankBadgeTop2 : item.rank === 3 ? styles.rankBadgeTop3 : ''}`}>{item.rank}</div>
              <div className={styles.compactInfo}>
                <div className={styles.compactName}>{item.name}</div>
                <div className={styles.compactMeta}>{item.pyung ? `${item.pyung}평` : ''}</div>
              </div>
              <div className={styles.compactValue}>
                <div className={styles.compactPrice} style={{ color: '#ef4444' }}>{item.gap}</div>
                <div className={styles.compactSub}>거래 {item.dealCount}건</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const COMPARE_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

function CompareView({ lawdCd, maxComplexes }: { lawdCd: string; maxComplexes: number }) {
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

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{maxComplexes === 2 ? '⚖️ 단지 2곳 시세 비교' : '🏘️ 여러 단지 시세 비교'}</h2>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최근 3년 · 매매 기준</span>
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
          <div className={styles.emptyState}>비교할 단지를 {maxComplexes === 2 ? '2곳' : '2곳 이상'} 검색해서 추가해주세요.</div>
        ) : loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>불러오는 중...</div>
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

function PriceMapView({ lawdCd }: { lawdCd: string }) {
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

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>🗺️ 평당가 분위 지도</h2>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최근 12개월 · 5분위 색상</span>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>지도를 불러오는 중입니다...</div>
        ) : loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>가격 데이터를 분석 중입니다...</div>
        ) : markers.length === 0 ? (
          <div className={styles.emptyState}>표시할 좌표 데이터가 없습니다.</div>
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
      <Header pageTitle={`${item.icon} ${item.title}`} />
      <div className="container">
        <Link href="/stats" className={styles.backLink}>&larr; 시장 통계로 돌아가기</Link>
        <div className={styles.headerTop}>
          <button className={styles.regionTrigger} onClick={openRegionModal}>
            <span>📍 {region.displayRegionName}</span>
            <span className={styles.regionTriggerCaret}>▾</span>
          </button>
        </div>

        {item.status === 'soon' ? (
          <ComingSoonCard title={item.title} reason={item.soonReason} />
        ) : slug in RANKING_CONFIGS ? (
          <RankingListView slug={slug} lawdCd={region.lawdCd} />
        ) : slug === 'volume' ? (
          <VolumeView lawdCd={region.lawdCd} displayRegionName={region.displayRegionName} />
        ) : slug === 'gap-invest' ? (
          <GapInvestView lawdCd={region.lawdCd} />
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
