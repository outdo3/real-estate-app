'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { buildPriceTrendPoints, filterTradesForArea, formatTrendDate, latestTrade, type PriceTrendTrade } from '@/lib/price-trend-data';
import { resolveTradeReadState, TRADE_API_UNAVAILABLE_MESSAGE } from '@/lib/trade-read-state';
import styles from './PriceTrendChart.module.css';

interface PriceTrendChartProps { aptName: string; lawdCd: string; dong?: string; selectedArea?: string; selectedAreaLabel?: string; }
type Period = '1년' | '3년' | '5년';
type TradeRead = { trades: PriceTrendTrade[]; error: string | null };

const PERIODS: Record<Period, number> = { '1년': 12, '3년': 36, '5년': 60 };
const SALE_COLOR = '#07865a';
const RENT_COLOR = '#3152d6';
const MIN_TREND_POINTS = 2;

export default function PriceTrendChart({ aptName, lawdCd, dong, selectedArea, selectedAreaLabel }: PriceTrendChartProps) {
  const [saleRead, setSaleRead] = useState<TradeRead | null>(null);
  const [rentRead, setRentRead] = useState<TradeRead | null>(null);
  const [period, setPeriod] = useState<Period>('3년');

  useEffect(() => {
    if (!aptName || !lawdCd) return;
    let cancelled = false;
    setSaleRead(null); setRentRead(null);
    const dongQuery = dong ? `&dong=${encodeURIComponent(dong)}` : '';
    const fetchType = async (type: 'apt' | 'rent'): Promise<TradeRead> => {
      try {
        const response = await fetch(`/api/apt/${encodeURIComponent(aptName)}?lawdCd=${lawdCd}&type=${type}&period=${PERIODS[period]}${dongQuery}`);
        if (!response.ok) return { trades: [], error: TRADE_API_UNAVAILABLE_MESSAGE };
        const data = await response.json();
        const state = resolveTradeReadState<PriceTrendTrade>(true, data);
        return { trades: state.trades, error: state.apiError };
      } catch { return { trades: [], error: TRADE_API_UNAVAILABLE_MESSAGE }; }
    };
    Promise.all([fetchType('apt'), fetchType('rent')]).then(([sale, rent]) => {
      if (!cancelled) {
        setSaleRead(sale);
        setRentRead({ ...rent, trades: rent.trades.filter((trade) => (trade.monthlyRent ?? 0) === 0) });
      }
    });
    return () => { cancelled = true; };
  }, [aptName, lawdCd, period, dong]);

  const loading = saleRead === null || rentRead === null;
  const needsAreaSelection = !selectedArea || selectedArea === '전체';
  // A chart line must never connect transactions from different canonical areas.
  const saleTrades = needsAreaSelection ? [] : (filterTradesForArea(saleRead?.trades ?? null, selectedArea) ?? []);
  const rentTrades = needsAreaSelection ? [] : (filterTradesForArea(rentRead?.trades ?? null, selectedArea) ?? []);
  const points = useMemo(() => buildPriceTrendPoints(saleTrades, rentTrades), [saleTrades, rentTrades]);
  const latestSale = useMemo(() => latestTrade(saleTrades), [saleTrades]);
  const latestRent = useMemo(() => latestTrade(rentTrades), [rentTrades]);
  const errors = [saleRead?.error, rentRead?.error].filter((error): error is string => !!error);
  const hasData = points.length > 0;
  const saleThin = saleTrades.length > 0 && saleTrades.length < MIN_TREND_POINTS;
  const rentThin = rentTrades.length > 0 && rentTrades.length < MIN_TREND_POINTS;
  const selectedLabel = selectedArea && selectedArea !== '전체' ? (selectedAreaLabel || `전용 ${selectedArea}㎡`) : '평형 선택 필요';
  const tickInterval = Math.max(0, Math.ceil(points.length / 5) - 1);

  const tooltip = ({ active, payload }: TooltipContentProps) => {
    const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
    if (!active || !point) return null;
    return <div style={{ background: '#fff', border: '1px solid #dfe6e9', borderRadius: 10, boxShadow: '0 8px 22px rgba(15, 23, 42, .12)', padding: '0.65rem 0.75rem' }}>
      <div style={{ color: '#56636d', fontSize: '0.78rem', marginBottom: '0.35rem' }}>{point.date.replace(/-/g, '.')}</div>
      {point.saleStr && <div style={{ color: SALE_COLOR, fontSize: '0.88rem', fontWeight: 800 }}>매매 {point.saleStr}</div>}
      {point.rentStr && <div style={{ color: RENT_COLOR, fontSize: '0.88rem', fontWeight: 800 }}>전세 {point.rentStr}</div>}
      <div style={{ color: '#66747e', fontSize: '0.76rem', marginTop: '0.35rem' }}>당일 거래 매매 {point.dailySaleCount}건 · 전세 {point.dailyRentCount}건</div>
    </div>;
  };

  return <section className={styles.card} aria-label="매매 전세 시세 추이">
    <div className={styles.header}><div><h3 className={styles.title}>매매·전세 시세 추이</h3><p className={styles.area}>{selectedLabel} · 개별 실거래 기준</p></div><div className={styles.periods} aria-label="조회 기간">{(Object.keys(PERIODS) as Period[]).map((item) => <button key={item} type="button" className={styles.period} aria-pressed={period === item} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
    {!loading && errors.length > 0 && <p className={styles.notice}>실거래가 데이터를 일부 불러오지 못했습니다. {errors[0]}</p>}
    {!loading && !errors.length && (saleThin || rentThin) && <p className={styles.notice}>{saleThin && rentThin ? '선택 평형은 매매·전세 거래가 모두 적어 추이를 읽기 어렵습니다.' : saleThin ? '선택 평형은 매매 거래가 적어 추이를 읽기 어렵습니다.' : '선택 평형은 전세 거래가 적어 추이를 읽기 어렵습니다.'}</p>}
    {loading ? <div className={styles.empty}>데이터를 불러오는 중입니다...</div> : needsAreaSelection ? <div className={styles.empty}>평형을 선택하면 해당 전용면적의 시세 추이를 볼 수 있어요.</div> : !hasData && errors.length > 0 ? <div className={styles.empty}>실거래가 데이터를 불러오지 못했습니다.</div> : !hasData ? <div className={styles.empty}>선택한 평형의 최근 거래가 없습니다.</div> : <>
      <div className={styles.volumeLegend}><span>하단 막대: 같은 날짜의 실제 거래 수</span><span className={styles.volumeLegend}><i className={styles.volumeBar} style={{ background: SALE_COLOR }} />매매</span><span className={styles.volumeLegend}><i className={styles.volumeBar} style={{ background: RENT_COLOR }} />전세</span></div>
      <div className={styles.legend}><span className={styles.legendItem}><i className={styles.swatch} style={{ background: SALE_COLOR }} />매매</span><span className={styles.legendItem}><i className={styles.swatch} style={{ background: RENT_COLOR }} />전세</span></div>
      <div className={styles.chart}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={points} margin={{ top: 8, right: 2, left: -12, bottom: 0 }}><CartesianGrid stroke="#e9eef0" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="id" axisLine={false} tickLine={false} interval={tickInterval} minTickGap={28} tick={{ fill: '#687680', fontSize: 11 }} tickFormatter={(id) => formatTrendDate(points[id]?.date || '')} /><YAxis yAxisId="price" axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} tick={{ fill: '#687680', fontSize: 11 }} tickFormatter={(value) => value >= 1 ? `${value}억` : `${Math.round(value * 10000)}만`} /><YAxis yAxisId="volume" orientation="right" axisLine={false} tickLine={false} width={20} allowDecimals={false} tick={{ fill: '#87939b', fontSize: 10 }} /><Tooltip content={tooltip} cursor={false} /><Bar yAxisId="volume" dataKey="saleVolume" fill={SALE_COLOR} fillOpacity={0.2} barSize={7} radius={[3, 3, 0, 0]} /><Bar yAxisId="volume" dataKey="rentVolume" fill={RENT_COLOR} fillOpacity={0.18} barSize={7} radius={[3, 3, 0, 0]} /><Line yAxisId="price" type="linear" dataKey="salePrice" stroke={SALE_COLOR} strokeWidth={2.25} dot={{ r: 2.5, fill: SALE_COLOR, strokeWidth: 0 }} activeDot={{ r: 4.5, fill: SALE_COLOR, stroke: '#fff', strokeWidth: 2 }} connectNulls /><Line yAxisId="price" type="linear" dataKey="rentPrice" stroke={RENT_COLOR} strokeWidth={2.25} dot={{ r: 2.5, fill: RENT_COLOR, strokeWidth: 0 }} activeDot={{ r: 4.5, fill: RENT_COLOR, stroke: '#fff', strokeWidth: 2 }} connectNulls /></ComposedChart></ResponsiveContainer></div>
      <div className={styles.summary}><div className={styles.summaryItem}><div className={styles.summaryLabel}>최근 매매</div><div className={styles.summaryValue} style={{ color: SALE_COLOR }}>{latestSale ? latestSale.priceStr : '데이터 부족'}</div>{latestSale && <div className={styles.summaryDate}>{latestSale.tradeDate.replace(/-/g, '.')} 신고</div>}</div><div className={styles.summaryItem}><div className={styles.summaryLabel}>최근 전세</div><div className={styles.summaryValue} style={{ color: RENT_COLOR }}>{latestRent ? latestRent.priceStr : '데이터 부족'}</div>{latestRent && <div className={styles.summaryDate}>{latestRent.tradeDate.replace(/-/g, '.')} 신고</div>}</div></div>
    </>}
  </section>;
}
