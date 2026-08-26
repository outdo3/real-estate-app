'use client';

import React, { useEffect, useState } from 'react';
import { computeInvestmentMetrics } from '@/lib/investment-metrics';

interface InvestmentMetricsProps {
  aptName: string;
  lawdCd: string;
  // 같은 구/군 안에 다른 동의 동일 브랜드 단지(예: "롯데캐슬", "푸르지오")가 있으면
  // 이름만으로는 섞여 조회될 수 있어, 알고 있으면 반드시 넘겨서 정확히 그 동으로 좁힌다.
  dong?: string;
  // 부모(apt-client.tsx)의 transaction 평형 선택값(원본 trade.area 문자열, 기본 '전체').
  // DETAIL TRADE AREA STATE SPLIT V1 — Unit Master canonicalExclusiveArea가 아니라 항상
  // raw trade.area만 받는다(PriceTrendChart와 동일한 identity). '전체'거나 넘기지 않으면
  // 전체 평형 동작(평형 선택 필요 표시)을 유지한다.
  selectedTradeArea?: string;
}

interface SimpleTrade {
  price: number;
  priceStr: string;
  area: string;
  tradeDate: string;
  tradeType: string;
  monthlyRent?: number;
}

// 기존 필터 토글(매매/전월세, 기간)과 무관하게 매매+전월세를 병렬로 고정 조회해서
// 갭 금액/전세가율을 계산한다. KakaoPlaces와 같은 패턴으로 자기완결형이다.
//
// PRODUCTION QA P0-B — 이전에는 period=6(최근 6개월)이었다. 같은 selectedTradeArea에서
// PriceTrendChart summary(최대 60개월/5년 창)는 순수 전세를 찾는데 이 컴포넌트는 "데이터
// 부족"이라 모순되게 보였다 — 실제 raw 데이터로 확인한 원인은 두 컴포넌트의 pure-jeonse
// 판정 기준(monthlyRent === 0) 자체는 완전히 동일했고, 오직 조회 기간(period)만 6개월 vs
// 최대 60개월로 달랐다(대신롯데캐슬 84.7855㎡ 실측: 최근 순수 전세가 조회 시점 기준 약
// 7개월 전이라 6개월 창에는 없고 36개월 창에는 있었음). "최근 거래"의 최근성 판정
// 자체(정렬 후 첫 값 선택)는 창을 넓혀도 그대로 유지되므로, PriceTrendChart가 제공하는
// 가장 넓은 조회기간(5년/60개월)과 맞춰 실제로 존재하는 최신 거래를 놓치지 않게 한다.
const METRICS_PERIOD_MONTHS = 60;
export default function InvestmentMetrics({ aptName, lawdCd, dong, selectedTradeArea }: InvestmentMetricsProps) {
  const [saleTrades, setSaleTrades] = useState<SimpleTrade[] | null>(null);
  const [rentTrades, setRentTrades] = useState<SimpleTrade[] | null>(null);

  useEffect(() => {
    if (!aptName || !lawdCd) return;
    let cancelled = false;
    setSaleTrades(null);
    setRentTrades(null);

    const dongQuery = dong ? `&dong=${encodeURIComponent(dong)}` : '';
    const fetchType = async (type: 'apt' | 'rent'): Promise<SimpleTrade[]> => {
      try {
        const res = await fetch(`/api/apt/${encodeURIComponent(aptName)}?lawdCd=${lawdCd}&type=${type}&period=${METRICS_PERIOD_MONTHS}${dongQuery}`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.trades || [];
      } catch (e) {
        return [];
      }
    };

    Promise.all([fetchType('apt'), fetchType('rent')]).then(([sale, rent]) => {
      if (cancelled) return;
      setSaleTrades(sale);
      setRentTrades(rent);
    });

    return () => {
      cancelled = true;
    };
  }, [aptName, lawdCd, dong]);

  const loading = saleTrades === null || rentTrades === null;

  const isAreaFiltered = !!selectedTradeArea && selectedTradeArea !== '전체';
  // Comparison metrics are meaningful only for one exact raw trade.area — never
  // a Unit Master canonicalExclusiveArea, and never a cross-area fallback.
  const { latestSale, matchedRent, jeonseRate, gap } = computeInvestmentMetrics(
    saleTrades ?? [],
    rentTrades ?? [],
    selectedTradeArea
  );

  const cardStyle: React.CSSProperties = {
    padding: '0.55rem 0.75rem',
    borderRadius: '8px',
    backgroundColor: '#f8fafc',
    border: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: '0.5rem',
  };

  const highlightCardStyle: React.CSSProperties = {
    ...cardStyle,
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
  };

  const labelStyle: React.CSSProperties = { fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' };
  const loadingValueStyle: React.CSSProperties = { fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-muted)' };
  const emptyValueStyle: React.CSSProperties = { fontSize: '0.78rem', color: 'var(--text-muted)' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', marginTop: '0.85rem' }}>
      <div style={cardStyle}>
        <span style={labelStyle}>매매가</span>
        {loading ? (
          <span style={loadingValueStyle}>조회 중</span>
        ) : !isAreaFiltered ? (
          <span style={emptyValueStyle}>평형 선택 필요</span>
        ) : latestSale ? (
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{latestSale.priceStr}</span>
        ) : (
          <span style={emptyValueStyle}>데이터 부족</span>
        )}
      </div>
      <div style={cardStyle}>
        <span style={labelStyle}>전세가</span>
        {loading ? (
          <span style={loadingValueStyle}>조회 중</span>
        ) : !isAreaFiltered ? (
          <span style={emptyValueStyle}>평형 선택 필요</span>
        ) : matchedRent ? (
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{matchedRent.priceStr}</span>
        ) : (
          <span style={emptyValueStyle}>데이터 부족</span>
        )}
      </div>
      <div style={cardStyle}>
        <span style={labelStyle}>전세가율</span>
        {loading ? (
          <span style={loadingValueStyle}>조회 중</span>
        ) : !isAreaFiltered ? (
          <span style={emptyValueStyle}>평형 선택 필요</span>
        ) : jeonseRate !== null ? (
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--primary-color)' }}>{jeonseRate.toFixed(1)}%</span>
        ) : (
          <span style={emptyValueStyle}>데이터 부족</span>
        )}
      </div>
      <div style={highlightCardStyle}>
        <span style={labelStyle}>필요 갭 금액</span>
        {loading ? (
          <span style={loadingValueStyle}>조회 중</span>
        ) : !isAreaFiltered ? (
          <span style={emptyValueStyle}>평형 선택 필요</span>
        ) : gap !== null ? (
          <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--primary-color)' }}>{gap.toFixed(1)}억</span>
        ) : (
          <span style={emptyValueStyle}>데이터 부족</span>
        )}
      </div>
    </div>
  );
}
