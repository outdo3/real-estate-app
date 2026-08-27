'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { BarChart3, Table2 } from 'lucide-react';
import FilterChip from '@/components/ui/FilterChip';
import ErrorState from '@/components/ui/ErrorState';
import InlineLoading from '@/components/ui/InlineLoading';
import { findNearestIndex, type IndexedPosition } from '@/lib/chart-crosshair';
import pageStyles from '@/app/stats/page.module.css';
import styles from './VolumeChartCard.module.css';

// STATISTICS V2.1-2A — TRANSACTION VOLUME CHART UI POLISH. 거래량 화면 전용
// 카드로 분리했다(기존 type-client.tsx의 VolumeView/VolumeSummaryStrip을
// 대체) — 이 화면만 아파트 상세페이지의 PriceTrendChart(src/components/
// PriceTrendChart.tsx)가 이미 검증한 tap/drag crosshair 패턴을 쓰기
// 때문에, 다른 stats 화면들이 공유하는 page.module.css의 .panel/.panelBody를
// 그대로 재사용하지 않고 독립된 카드 스타일을 갖는다(그래서 별도 컴포넌트로
// 분리 — 공용 클래스를 건드리면 다른 화면 전부가 영향을 받는다). "표"
// (연도별) 뷰만은 계산/표시 로직을 전혀 바꾸지 않기 위해 기존
// page.module.css의 .tableWrapper/.yearlyTable* 클래스를 그대로 재사용한다.

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type DealType = 'sale' | 'jeonse' | 'wolse';
const DEAL_TYPE_OPTIONS: { key: DealType; label: string; indexLabel: string }[] = [
  { key: 'sale', label: '매매', indexLabel: '매매가격지수' },
  { key: 'jeonse', label: '전세', indexLabel: '전세가격지수' },
  { key: 'wolse', label: '월세', indexLabel: '월세가격지수' },
];

// STATISTICS V2.1-2 §13~§18 — dashboard route가 이미 계산해준
// volumeSummaryByPeriod[preset]만 읽는다(새 fetch 없음, 데이터 계약 무변경).
const VOLUME_COMPARISON_OPTIONS: { key: string; label: string }[] = [
  { key: '7d', label: '최근 7일' },
  { key: '30d', label: '최근 30일' },
  { key: '3m', label: '최근 3개월' },
];

const VOLUME_COLOR = 'var(--primary-color)';
const INDEX_COLOR = '#3152d6';

interface ChartPoint {
  month: string;
  volume: number;
  priceIndex: number | null;
}

export default function VolumeChartCard({
  lawdCd,
  sidoCode,
  displayRegionName,
}: {
  lawdCd: string | null;
  sidoCode: string;
  displayRegionName: string;
}) {
  const router = useRouter();
  const [chartView, setChartView] = useState<'graph' | 'table'>('graph');
  const [dealType, setDealType] = useState<DealType>('sale');
  const [comparisonPreset, setComparisonPreset] = useState('30d');

  const dashboardQuery = lawdCd ? `lawdCd=${lawdCd}` : `sidoCode=${sidoCode}`;
  const { data: apiResponse, isLoading } = useSWR(
    `/api/stats/dashboard?${dashboardQuery}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );
  const { data: yearlyResponse } = useSWR(
    lawdCd && chartView === 'table' ? `/api/stats/yearly?lawdCd=${lawdCd}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );

  const data = apiResponse?.success ? apiResponse.data : null;
  const chartData: ChartPoint[] = data?.chartDataByType?.[dealType] || data?.chartData || [];
  const yearlyTableByType = yearlyResponse?.success ? yearlyResponse.data.yearlyTableByType : null;
  const yearlyTable = yearlyTableByType?.[dealType] || (yearlyResponse?.success ? yearlyResponse.data.yearlyTable : null);
  const dealTypeMeta = DEAL_TYPE_OPTIONS.find((o) => o.key === dealType)!;

  const byPeriod = data?.volumeSummaryByPeriod?.[comparisonPreset];
  const metric = byPeriod?.[dealType];
  const changeColor = !metric ? 'var(--text-secondary)' : metric.changeCount > 0 ? 'var(--up-color)' : metric.changeCount < 0 ? 'var(--down-color)' : 'var(--text-secondary)';

  // DETAIL PRICE CHART INTERACTION P1 패턴 재사용 — activeIndex를 Recharts의
  // 내부 hover/touch 상태와 분리해 직접 관리한다(탭 즉시 선택 + 드래그 스크럽
  // 모두 동일한 pointerdown/pointermove 핸들러 하나로 처리). 상세 근거는
  // PriceTrendChart.tsx의 동일 패턴 주석 참고 — 여기서는 그대로 재사용만.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const pointPositionsRef = useRef<IndexedPosition[]>([]);
  useEffect(() => { setActiveIndex(null); }, [dealType, lawdCd, sidoCode]);

  const chartCleanupRef = useRef<(() => void) | null>(null);
  const chartRefCallback = useCallback((el: HTMLDivElement | null) => {
    chartCleanupRef.current?.();
    chartCleanupRef.current = null;
    if (!el) return;
    // PriceTrendChart.tsx와 동일한 이유로 필요 — Recharts accessibilityLayer가
    // .recharts-surface에 tabIndex=0을 줘서 탭 한 번에도 포커스가 이동하고,
    // 그 결과 모바일에서 검은 focus 사각형이 뜨는 것을 이미 그 컴포넌트에서
    // preventDefault(pointerdown)로 해결했다 — 동일 버그 재발 방지를 위해
    // 그대로 재사용한다.
    const preventPointerFocus = (event: PointerEvent) => { event.preventDefault(); };
    const markPointer = () => { el.dataset.inputModality = 'pointer'; };
    const markKeyboard = (e: KeyboardEvent) => { if (e.key === 'Tab') el.dataset.inputModality = 'keyboard'; };

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

  const capturedPositions: IndexedPosition[] = [];
  const makeDot = () => {
    const dotRenderer = (dotProps: { cx?: number; cy?: number; index?: number; value?: unknown }) => {
      const { cx, cy, index, value } = dotProps;
      if (value == null || typeof cx !== 'number' || typeof cy !== 'number' || typeof index !== 'number') return null;
      capturedPositions.push({ id: index, x: cx });
      const isActive = index === activeIndex;
      return (
        <circle
          key={`vol-dot-${index}`}
          cx={cx}
          cy={cy}
          r={isActive ? 5 : 2.5}
          fill={INDEX_COLOR}
          stroke={isActive ? '#fff' : undefined}
          strokeWidth={isActive ? 2 : 0}
        />
      );
    };
    dotRenderer.displayName = 'VolumeChartDot';
    return dotRenderer;
  };
  useLayoutEffect(() => {
    pointPositionsRef.current = capturedPositions;
  });

  // 막대(거래량)도 active 포인트에서 살짝 더 진하게 — "막대가 거래량이라는
  // 것이 한눈에 들어오게" 하는 안정적 강조(§4-B). 장식이 아니라 crosshair와
  // 같은 지점을 가리키는 정보 강조라 과하지 않다.
  const makeBarShape = () => {
    const barShape = (barProps: any) => {
      const { x, y, width, height, index } = barProps;
      const isActive = index === activeIndex;
      return <rect x={x} y={y} width={width} height={height} rx={3} ry={3} fill={VOLUME_COLOR} fillOpacity={isActive ? 0.85 : 0.45} />;
    };
    return barShape;
  };

  const tooltip = ({ active }: TooltipContentProps) => {
    if (!active || activeIndex == null) return null;
    const point = chartData[activeIndex];
    if (!point) return null;
    return (
      <div className={styles.tooltip}>
        <div className={styles.tooltipDate}>{point.month}</div>
        <div className={styles.tooltipRow}><span className={styles.tooltipSwatchBar} />거래량 <strong>{point.volume.toLocaleString('ko-KR')}건</strong></div>
        {point.priceIndex != null && (
          <div className={styles.tooltipRow}><span className={styles.tooltipSwatchLine} />{dealTypeMeta.indexLabel} <strong>{point.priceIndex}</strong></div>
        )}
      </div>
    );
  };

  if (isLoading) return <InlineLoading message="분석 중입니다..." />;
  if (!data) return <ErrorState variant="section" message="거래량 데이터를 불러오지 못했습니다." />;

  return (
    <section className={styles.card} aria-label="거래량·시세 추이">
      <div className={styles.header}>
        <h3 className={styles.title}>거래량·시세 추이</h3>
        <div className={styles.viewToggle} role="group" aria-label="그래프/표 보기 전환">
          <button type="button" className={styles.viewToggleBtn} aria-pressed={chartView === 'graph'} onClick={() => setChartView('graph')}>
            <BarChart3 size={13} aria-hidden="true" />그래프
          </button>
          <button
            type="button"
            className={styles.viewToggleBtn}
            aria-pressed={chartView === 'table'}
            onClick={() => lawdCd && setChartView('table')}
            disabled={!lawdCd}
            title={!lawdCd ? '연도별 표는 시/군/구를 선택하면 볼 수 있어요' : undefined}
          >
            <Table2 size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={styles.chipRow}>
        {DEAL_TYPE_OPTIONS.map((opt) => (
          <FilterChip key={opt.key} active={dealType === opt.key} onClick={() => setDealType(opt.key)}>
            {opt.label}
          </FilterChip>
        ))}
      </div>

      {byPeriod && metric && (
        <>
          <div className={styles.summary}>
            <div className={styles.summaryLabel}>{displayRegionName} · {dealTypeMeta.label} · {VOLUME_COMPARISON_OPTIONS.find((p) => p.key === comparisonPreset)?.label}</div>
            <div className={styles.summaryRow}>
              <span className={styles.summaryValue}>{metric.currentCount.toLocaleString('ko-KR')}건</span>
              {metric.previousCount > 0 ? (
                <span className={styles.summaryChange} style={{ color: changeColor }}>
                  이전 {metric.previousCount.toLocaleString('ko-KR')}건 대비 {metric.changeCount > 0 ? '▲' : metric.changeCount < 0 ? '▼' : ''}
                  {Math.abs(metric.changeCount).toLocaleString('ko-KR')}건{metric.changePct != null ? ` (${metric.changePct > 0 ? '+' : ''}${metric.changePct}%)` : ''}
                </span>
              ) : (
                <span className={styles.summaryEmpty}>이전 동일 기간에는 거래가 없었어요.</span>
              )}
            </div>
            <div className={styles.summaryPeriodNote}>이전 동일 기간: {byPeriod.previousPeriod.from}~{byPeriod.previousPeriod.to}</div>
          </div>

          <div className={styles.chipRow}>
            {VOLUME_COMPARISON_OPTIONS.map((p) => (
              <FilterChip key={p.key} active={comparisonPreset === p.key} onClick={() => setComparisonPreset(p.key)}>
                {p.label}
              </FilterChip>
            ))}
          </div>

          <button className={styles.crossLinkBtn} onClick={() => router.push(`/stats/top-traded?period=${comparisonPreset}&dealType=${dealType}`)}>
            이 기간 거래가 많은 단지 보기
          </button>
        </>
      )}

      {chartView === 'graph' ? (
        <>
          <div className={styles.legend}>
            <span className={styles.legendItem}><i className={styles.legendBar} />거래량(건)</span>
            <span className={styles.legendItem}><i className={styles.legendLine} />{dealTypeMeta.indexLabel}(최초 유효월=100)</span>
          </div>
          <div className={styles.chart} ref={chartRefCallback}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#e9eef0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="month" scale="band" axisLine={false} tickLine={false} tick={{ fill: '#687680', fontSize: 11 }} dy={8} />
                <YAxis yAxisId="volume" axisLine={false} tickLine={false} width={34} tick={{ fill: '#87939b', fontSize: 10 }} />
                <YAxis yAxisId="index" orientation="right" axisLine={false} tickLine={false} width={30} domain={['auto', 'auto']} tick={{ fill: '#87939b', fontSize: 10 }} />
                <Tooltip content={tooltip} cursor={false} active={activeIndex !== null} defaultIndex={activeIndex !== null ? String(activeIndex) : undefined} />
                {activeIndex !== null && chartData[activeIndex] && (
                  <ReferenceLine x={chartData[activeIndex].month} yAxisId="volume" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" />
                )}
                <Bar yAxisId="volume" dataKey="volume" barSize={18} shape={makeBarShape()} isAnimationActive={false} />
                <Line
                  yAxisId="index"
                  type="monotone"
                  dataKey="priceIndex"
                  stroke={INDEX_COLOR}
                  strokeWidth={2.25}
                  dot={makeDot()}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className={styles.footnote}>최근 12개월 실거래 기준 · 가격지수는 최초 유효월을 100으로 환산한 값이에요.</p>
          <p className={styles.guideNote}>전세지수 상승·매매지수 하락은 실거주 수요 대비 매매 심리가 위축된 상태를 뜻해요. 전세가율이 높아지면 매매가 하방 지지선이 형성되며 매수 전환 수요 유입 가능성을 시사해요.</p>
        </>
      ) : (
        <div className={pageStyles.tableWrapper}>
          <table className={pageStyles.yearlyTable}>
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
                  <tr key={`skeleton-${i}`}><td colSpan={5}><div className={pageStyles.skeletonBar} /></td></tr>
                ))
              ) : (
                [...yearlyTable].reverse().map((row: any) => (
                  <tr key={row.year}>
                    <td className={pageStyles.yearlyTableYear}>{row.year}년</td>
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
      )}
    </section>
  );
}
