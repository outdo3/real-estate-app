'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { buildPriceTrendPoints, filterTradesForArea, formatTrendDate, latestTrade, type PriceTrendTrade } from '@/lib/price-trend-data';
import { buildTransactionAreaOptions } from '@/lib/trade-area-selection';
import { toggleSeriesVisibility, type SeriesVisibility } from '@/lib/series-visibility';
import { findNearestIndex, type IndexedPosition } from '@/lib/chart-crosshair';
import { resolveTradeReadState, TRADE_API_UNAVAILABLE_MESSAGE } from '@/lib/trade-read-state';
import styles from './PriceTrendChart.module.css';
import type { DisplayUnit } from '@/lib/area-utils';

// DETAIL TRADE AREA STATE SPLIT V1 — selectedTradeArea/onSelectArea always carry
// raw trade.area values (never Unit Master canonicalExclusiveArea). unitMaster is
// used only for display enrichment (unitLabel) when a raw area happens to exact-match
// a canonical value; it never becomes the filter/select identity itself.
interface PriceTrendChartProps { aptName: string; lawdCd: string; dong?: string; selectedTradeArea?: string; selectedTradeAreaLabel?: string; unitMaster?: DisplayUnit[] | null; onSelectArea?: (area: string) => void; }
type Period = '1년' | '3년' | '5년';
type TradeRead = { trades: PriceTrendTrade[]; error: string | null };

const PERIODS: Record<Period, number> = { '1년': 12, '3년': 36, '5년': 60 };
const SALE_COLOR = '#07865a';
const RENT_COLOR = '#3152d6';
const MIN_TREND_POINTS = 2;

export default function PriceTrendChart({ aptName, lawdCd, dong, selectedTradeArea, selectedTradeAreaLabel, unitMaster, onSelectArea }: PriceTrendChartProps) {
  const [saleRead, setSaleRead] = useState<TradeRead | null>(null);
  const [rentRead, setRentRead] = useState<TradeRead | null>(null);
  const [period, setPeriod] = useState<Period>('3년');
  // PRODUCTION QA P0-C — explicit series display control, replacing the previously
  // decorative (non-interactive) legend. Volume bars keep their existing meaning
  // regardless of this toggle (only the price lines react). At least one series
  // must stay visible — toggleSeries below refuses to turn the last one off.
  const [seriesVisible, setSeriesVisible] = useState<SeriesVisibility>({ sale: true, rent: true });
  const toggleSeries = useCallback((key: 'sale' | 'rent') => {
    setSeriesVisible((prev) => toggleSeriesVisibility(prev, key));
  }, []);

  // DETAIL PRICE CHART INTERACTION P1 — Recharts only recomputes its own active
  // point on 'touchmove' (see node_modules/recharts/lib/chart/RechartsWrapper.js:
  // 'touchstart' just forwards the event, only 'touchmove' dispatches the
  // position-lookup middleware), so a plain tap left the tooltip/marker stuck on
  // whatever was active before until the user dragged. activeIndex is now fully
  // self-managed: pointerPositionsRef records each rendered dot's real on-screen
  // x (captured via the dot render-prop below, so it's exact regardless of chart
  // margins/axis widths/responsive size — no scale math to keep in sync), and
  // pointerdown/pointermove hit-test against that on every tap and drag alike.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const pointPositionsRef = useRef<IndexedPosition[]>([]);

  // Recharts' accessibilityLayer gives the root SVG (.recharts-surface, sized to
  // the whole chart) tabIndex=0 so keyboard users can reach it — but any tap on a
  // volume bar or the plot area also moves DOM focus there, and native
  // :focus-visible heuristics for a manually-tabindexed, non-native element like
  // an <svg> are not reliably "not visible" on touch across mobile engines (a
  // plain `:focus:not(:focus-visible)` CSS rule was tried before and still
  // surfaced a black focus rectangle on real mobile). Track input modality
  // ourselves instead of trusting that heuristic: only a Tab keypress marks the
  // next focus as keyboard-driven; any pointerdown (mouse/touch/pen) clears it.
  // Keyboard users still get a visible ring; touch/mouse never do.
  // The .chart div only mounts once hasData is true (a later render, gated deep
  // in the loading/needsAreaSelection/hasData ternary below) — a plain
  // useEffect(() => {...}, []) would run before that node exists and never
  // attach anything. A callback ref fires exactly when React attaches/detaches
  // the real node, regardless of which branch renders it.
  const chartCleanupRef = useRef<(() => void) | null>(null);
  const chartRefCallback = useCallback((el: HTMLDivElement | null) => {
    chartCleanupRef.current?.();
    chartCleanupRef.current = null;
    if (!el) return;
    // PRODUCTION QA P0 REOPEN — hiding the ring after the fact (previous STEP)
    // still left a black rectangle on real Android: it depends on the browser's
    // :focus-visible heuristic correctly treating pointer-triggered focus as
    // "not visible" on a manually-tabindexed <svg>, which is not reliable across
    // mobile engines (verified inconsistent even within this session's own
    // Chrome tests). The definitive fix is to stop the surface from ever
    // becoming document.activeElement on pointer/touch at all: calling
    // preventDefault() on 'pointerdown' cancels the browser's default
    // focus-the-target action for that interaction. .chart only ever contains
    // the chart SVG (no buttons/inputs), and Recharts drives its own touch
    // tooltip via a separate 'touchmove' listener (see RechartsWrapper.js —
    // not focus, not pointerdown), so this does not affect tooltip/line/bar
    // interaction. Keyboard Tab focus is a fully separate code path and is
    // unaffected, so keyboard accessibility is preserved.
    const preventPointerFocus = (event: PointerEvent) => { event.preventDefault(); };
    const markPointer = () => { el.dataset.inputModality = 'pointer'; };
    // Tab-into-the-chart fires its keydown on whatever element currently has
    // focus (often outside .chart entirely), not on the surface itself — so this
    // must listen on the document, not just the chart subtree, or a genuine
    // keyboard Tab landing on the surface from outside would be missed.
    const markKeyboard = (e: KeyboardEvent) => { if (e.key === 'Tab') el.dataset.inputModality = 'keyboard'; };

    // DETAIL PRICE CHART INTERACTION P1 — deterministic tap/drag hit-testing.
    // pointermove fires continuously while a mouse hovers (no button needed) and
    // only while a touch is actively down and moving (there is no touch
    // "hover"), so one handler naturally covers both desktop hover-follow and
    // mobile drag-to-scrub. pointerdown alone does the same lookup immediately
    // so the very first tap selects the nearest point instead of waiting for a
    // drag to happen to trigger Recharts' own touchmove-only recomputation.
    const hitTest = (clientX: number) => {
      const svg = el.querySelector('.recharts-surface') as SVGSVGElement | null;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const idx = findNearestIndex(clientX - rect.left, pointPositionsRef.current);
      if (idx !== null) setActiveIndex(idx);
    };
    const onPointerDown = (event: PointerEvent) => {
      hitTest(event.clientX);
      try { el.setPointerCapture(event.pointerId); } catch { /* not all pointer types support capture */ }
    };
    const onPointerMove = (event: PointerEvent) => { hitTest(event.clientX); };
    const onPointerUp = (event: PointerEvent) => {
      try { el.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    };
    // Only clear on genuine mouse leave — touch has no hover concept, and
    // leaving the crosshair on the last-touched point after lifting a finger is
    // the expected mobile chart behavior (matches native map/chart apps).
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') setActiveIndex(null);
    };

    el.addEventListener('pointerdown', preventPointerFocus);
    el.addEventListener('pointerdown', markPointer);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('keydown', markKeyboard);
    chartCleanupRef.current = () => {
      el.removeEventListener('pointerdown', preventPointerFocus);
      el.removeEventListener('pointerdown', markPointer);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('keydown', markKeyboard);
    };
  }, []);

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
  const needsAreaSelection = !selectedTradeArea || selectedTradeArea === '전체';
  // A chart line must never connect transactions from different raw trade areas.
  const saleTrades = needsAreaSelection ? [] : (filterTradesForArea(saleRead?.trades ?? null, selectedTradeArea) ?? []);
  const rentTrades = needsAreaSelection ? [] : (filterTradesForArea(rentRead?.trades ?? null, selectedTradeArea) ?? []);
  const points = useMemo(() => buildPriceTrendPoints(saleTrades, rentTrades), [saleTrades, rentTrades]);
  // Clear any selected crosshair point when the underlying series data actually
  // changes (area/period) so a stale index never points at different data — but
  // not on a seriesVisible toggle alone. Deliberately keyed on the *primitive*
  // values that actually determine a data change, not on `points` itself:
  // saleTrades/rentTrades are freshly filtered (new array reference) on every
  // render regardless of whether the data changed, so a memo built on them is
  // never referentially stable either — an effect keyed on that memo would fire
  // on every render and immediately null out activeIndex right after it was set.
  useEffect(() => { setActiveIndex(null); }, [selectedTradeArea, period]);
  const latestSale = useMemo(() => latestTrade(saleTrades), [saleTrades]);
  const latestRent = useMemo(() => latestTrade(rentTrades), [rentTrades]);
  const errors = [saleRead?.error, rentRead?.error].filter((error): error is string => !!error);
  // Transaction selector source: raw sale + pure-jeonse trade.area union only —
  // never Unit Master canonicalExclusiveArea (see buildTransactionAreaOptions doc).
  // rentRead.trades is already pure-jeonse-only (monthlyRent === 0, filtered above).
  const selectableAreas = useMemo(
    () => buildTransactionAreaOptions(saleRead?.trades ?? [], rentRead?.trades ?? []),
    [saleRead, rentRead]
  );
  const hasData = points.length > 0;
  const saleThin = saleTrades.length > 0 && saleTrades.length < MIN_TREND_POINTS;
  const rentThin = rentTrades.length > 0 && rentTrades.length < MIN_TREND_POINTS;
  const selectedLabel = selectedTradeArea && selectedTradeArea !== '전체' ? (selectedTradeAreaLabel || `전용 ${selectedTradeArea}㎡`) : '평형 선택 필요';
  const tickInterval = Math.max(0, Math.ceil(points.length / 5) - 1);

  const tooltip = ({ active, payload }: TooltipContentProps) => {
    const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
    if (!active || !point) return null;
    return <div style={{ background: '#fff', border: '1px solid #dfe6e9', borderRadius: 10, boxShadow: '0 8px 22px rgba(15, 23, 42, .12)', padding: '0.65rem 0.75rem' }}>
      <div style={{ color: '#56636d', fontSize: '0.78rem', marginBottom: '0.35rem' }}>{point.date.replace(/-/g, '.')}</div>
      {seriesVisible.sale && point.saleStr && <div style={{ color: SALE_COLOR, fontSize: '0.88rem', fontWeight: 800 }}>매매 {point.saleStr}</div>}
      {seriesVisible.rent && point.rentStr && <div style={{ color: RENT_COLOR, fontSize: '0.88rem', fontWeight: 800 }}>전세 {point.rentStr}</div>}
      <div style={{ color: '#66747e', fontSize: '0.76rem', marginTop: '0.35rem' }}>당일 거래 매매 {point.dailySaleCount}건 · 전세 {point.dailyRentCount}건</div>
    </div>;
  };

  const unitLabel = (area: string) => {
    const unit = unitMaster?.find((item) => item.canonicalExclusiveArea === area);
    return unit ? `${unit.representativePyeong ? `${unit.representativePyeong}평 · ` : ''}전용 ${unit.displayExclusiveArea}㎡` : `전용 ${parseFloat(area).toFixed(2).replace(/\.00$/, '')}㎡`;
  };

  // Freshly created each render — a plain local array, not a ref, so the dot
  // render-props below (called synchronously while Recharts constructs the
  // Line elements) can push into it without touching a ref during render
  // (React forbids reading/writing ref.current mid-render — see the
  // useLayoutEffect below, which is the correct place to commit this into
  // pointPositionsRef once the render has actually committed). This still
  // captures real rendered geometry (exact cx per point), not a recomputed or
  // guessed scale, so it never drifts out of sync with margins, axis widths,
  // or ResponsiveContainer resizing.
  const capturedPositions: IndexedPosition[] = [];
  const makeDot = (color: string, seriesShown: boolean) => {
    const dotRenderer = (dotProps: { cx?: number; cy?: number; index?: number; value?: unknown }) => {
      const { cx, cy, index, value } = dotProps;
      if (value == null || typeof cx !== 'number' || typeof cy !== 'number' || typeof index !== 'number') return null;
      capturedPositions.push({ id: index, x: cx });
      const isActive = index === activeIndex;
      return (
        <circle
          key={`dot-${color}-${index}`}
          cx={cx}
          cy={cy}
          r={isActive ? 5 : 2.5}
          fill={color}
          fillOpacity={seriesShown ? 1 : 0}
          stroke={isActive && seriesShown ? '#fff' : undefined}
          strokeWidth={isActive && seriesShown ? 2 : 0}
        />
      );
    };
    dotRenderer.displayName = `PriceTrendChartDot(${color})`;
    return dotRenderer;
  };
  // Commits this render's captured positions into the ref once the render has
  // actually committed (an effect, not render-time), then every pointer
  // handler reads the latest committed set. Runs after every render on
  // purpose — capturedPositions is a fresh array each time, so there is no
  // stable dependency to compare against, and the assignment itself is cheap.
  useLayoutEffect(() => {
    pointPositionsRef.current = capturedPositions;
  });
  // Both series' dot callbacks together cover every point (each index belongs
  // to exactly one series — see buildPriceTrendPoints), so hit-testing stays
  // complete even while one series is toggled off (opacity 0, still mounted).
  const activePoint = activeIndex !== null ? points[activeIndex] : undefined;

  return <section className={styles.card} aria-label="매매 전세 시세 추이">
    <div className={styles.header}><div><h3 className={styles.title}>매매·전세 시세 추이</h3>{onSelectArea && <select className={styles.unitSelector} aria-label="차트 평형 선택" value={selectedTradeArea || '전체'} onChange={(event) => onSelectArea(event.target.value)}><option value="전체">평형 선택</option>{selectableAreas.map((area) => <option key={area} value={area}>{unitLabel(area)}</option>)}</select>}<p className={styles.area}>{selectedLabel} · 개별 실거래 기준</p></div><div className={styles.periods} aria-label="조회 기간">{(Object.keys(PERIODS) as Period[]).map((item) => <button key={item} type="button" className={styles.period} aria-pressed={period === item} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
    {!loading && errors.length > 0 && <p className={styles.notice}>실거래가 데이터를 일부 불러오지 못했습니다. {errors[0]}</p>}
    {!loading && !errors.length && (saleThin || rentThin) && <p className={styles.notice}>{saleThin && rentThin ? '선택 평형은 매매·전세 거래가 모두 적어 추이를 읽기 어렵습니다.' : saleThin ? '선택 평형은 매매 거래가 적어 추이를 읽기 어렵습니다.' : '선택 평형은 전세 거래가 적어 추이를 읽기 어렵습니다.'}</p>}
    {loading ? <div className={styles.empty}>데이터를 불러오는 중입니다...</div> : needsAreaSelection ? <div className={styles.empty}>평형을 선택해 시세 추이를 확인하세요.</div> : !hasData && errors.length > 0 ? <div className={styles.empty}>실거래가 데이터를 불러오지 못했습니다.</div> : !hasData ? <div className={styles.empty}>선택한 평형의 최근 거래가 없습니다.</div> : <>
      <div className={styles.volumeLegend}><span>하단 막대: 같은 날짜의 실제 거래 수</span><span className={styles.volumeLegend}><i className={styles.volumeBar} style={{ background: SALE_COLOR }} />매매</span><span className={styles.volumeLegend}><i className={styles.volumeBar} style={{ background: RENT_COLOR }} />전세</span></div>
      <div className={styles.legend} role="group" aria-label="매매·전세 시세 표시 전환">
        <button type="button" className={styles.legendItem} aria-pressed={seriesVisible.sale} onClick={() => toggleSeries('sale')}>
          <i className={styles.swatch} style={{ background: SALE_COLOR, opacity: seriesVisible.sale ? 1 : 0.35 }} />
          <span style={{ opacity: seriesVisible.sale ? 1 : 0.5 }}>매매</span>
        </button>
        <button type="button" className={styles.legendItem} aria-pressed={seriesVisible.rent} onClick={() => toggleSeries('rent')}>
          <i className={styles.swatch} style={{ background: RENT_COLOR, opacity: seriesVisible.rent ? 1 : 0.35 }} />
          <span style={{ opacity: seriesVisible.rent ? 1 : 0.5 }}>전세</span>
        </button>
      </div>
      <div className={styles.chart} ref={chartRefCallback}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={points} margin={{ top: 8, right: 2, left: -12, bottom: 0 }}><CartesianGrid stroke="#e9eef0" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="id" axisLine={false} tickLine={false} interval={tickInterval} minTickGap={28} tick={{ fill: '#687680', fontSize: 11 }} tickFormatter={(id) => formatTrendDate(points[id]?.date || '')} /><YAxis yAxisId="price" axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} tick={{ fill: '#687680', fontSize: 11 }} tickFormatter={(value) => value >= 1 ? `${value}억` : `${Math.round(value * 10000)}만`} /><YAxis yAxisId="volume" orientation="right" axisLine={false} tickLine={false} width={20} allowDecimals={false} tick={{ fill: '#87939b', fontSize: 10 }} /><Tooltip content={tooltip} cursor={false} active={activeIndex !== null} defaultIndex={activeIndex !== null ? String(activeIndex) : undefined} />{activeIndex !== null && <ReferenceLine x={activeIndex} yAxisId="price" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" />}{activePoint && seriesVisible.sale && activePoint.salePrice != null && <ReferenceLine y={activePoint.salePrice} yAxisId="price" stroke={SALE_COLOR} strokeOpacity={0.3} strokeWidth={1} strokeDasharray="2 4" />}{activePoint && seriesVisible.rent && activePoint.rentPrice != null && <ReferenceLine y={activePoint.rentPrice} yAxisId="price" stroke={RENT_COLOR} strokeOpacity={0.3} strokeWidth={1} strokeDasharray="2 4" />}<Bar yAxisId="volume" dataKey="saleVolume" fill={SALE_COLOR} fillOpacity={0.2} barSize={7} radius={[3, 3, 0, 0]} /><Bar yAxisId="volume" dataKey="rentVolume" fill={RENT_COLOR} fillOpacity={0.18} barSize={7} radius={[3, 3, 0, 0]} /><Line yAxisId="price" type="linear" dataKey="salePrice" stroke={SALE_COLOR} strokeOpacity={seriesVisible.sale ? 1 : 0} strokeWidth={2.25} dot={makeDot(SALE_COLOR, seriesVisible.sale)} activeDot={false} connectNulls isAnimationActive={false} /><Line yAxisId="price" type="linear" dataKey="rentPrice" stroke={RENT_COLOR} strokeOpacity={seriesVisible.rent ? 1 : 0} strokeWidth={2.25} dot={makeDot(RENT_COLOR, seriesVisible.rent)} activeDot={false} connectNulls isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div>
      <div className={styles.summary}><div className={styles.summaryItem}><div className={styles.summaryLabel}>최근 매매</div><div className={styles.summaryValue} style={{ color: SALE_COLOR }}>{latestSale ? latestSale.priceStr : '데이터 부족'}</div>{latestSale && <div className={styles.summaryDate}>{latestSale.tradeDate.replace(/-/g, '.')} 신고</div>}</div><div className={styles.summaryItem}><div className={styles.summaryLabel}>최근 전세</div><div className={styles.summaryValue} style={{ color: RENT_COLOR }}>{latestRent ? latestRent.priceStr : '데이터 부족'}</div>{latestRent && <div className={styles.summaryDate}>{latestRent.tradeDate.replace(/-/g, '.')} 신고</div>}</div></div>
    </>}
  </section>;
}
