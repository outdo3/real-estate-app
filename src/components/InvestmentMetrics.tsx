'use client';

import React, { useEffect, useState } from 'react';

interface InvestmentMetricsProps {
  aptName: string;
  lawdCd: string;
}

interface SimpleTrade {
  price: number;
  priceStr: string;
  area: string;
  tradeDate: string;
  tradeType: string;
  monthlyRent?: number;
}

// 기존 필터 토글(매매/전월세, 기간)과 무관하게 최근 6개월 매매+전월세를 병렬로 고정
// 조회해서 갭 금액/전세가율을 계산한다. KakaoPlaces와 같은 패턴으로 자기완결형이다.
export default function InvestmentMetrics({ aptName, lawdCd }: InvestmentMetricsProps) {
  const [saleTrades, setSaleTrades] = useState<SimpleTrade[] | null>(null);
  const [rentTrades, setRentTrades] = useState<SimpleTrade[] | null>(null);

  useEffect(() => {
    if (!aptName || !lawdCd) return;
    let cancelled = false;
    setSaleTrades(null);
    setRentTrades(null);

    const fetchType = async (type: 'apt' | 'rent'): Promise<SimpleTrade[]> => {
      try {
        const res = await fetch(`/api/apt/${encodeURIComponent(aptName)}?lawdCd=${lawdCd}&type=${type}&period=6`);
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
  }, [aptName, lawdCd]);

  const loading = saleTrades === null || rentTrades === null;

  const latestSale = saleTrades && saleTrades.length > 0
    ? [...saleTrades].sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime())[0]
    : null;

  // 순수 전세(월세 없음)만 필터링 — 월세가 섞이면 보증금이 전세 보증금과 비교 불가능한 규모라
  // 갭/전세가율 계산이 완전히 틀어진다.
  const jeonseOnlyRent = rentTrades ? rentTrades.filter((r) => (r.monthlyRent ?? 0) === 0) : [];
  const sortedRent = [...jeonseOnlyRent].sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());
  const matchedRent = latestSale
    ? sortedRent.find((r) => r.area === latestSale.area) || (sortedRent.length > 0 ? sortedRent[0] : null)
    : null;

  const isSameArea = !!(latestSale && matchedRent && matchedRent.area === latestSale.area);
  const gap = latestSale && matchedRent ? latestSale.price - matchedRent.price : null;
  const jeonseRate = latestSale && matchedRent && latestSale.price > 0 ? (matchedRent.price / latestSale.price) * 100 : null;

  const cardStyle: React.CSSProperties = {
    padding: '0.55rem 0.75rem',
    borderRadius: '8px',
    backgroundColor: '#f8fafc',
    border: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
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
        ) : matchedRent ? (
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{matchedRent.priceStr}</span>
        ) : (
          <span style={emptyValueStyle}>데이터 부족</span>
        )}
      </div>
      <div style={cardStyle} title={!loading && jeonseRate !== null && !isSameArea ? '동일 평형 매물이 없어 다른 평형의 최근 거래 기준으로 계산(참고용)' : undefined}>
        <span style={labelStyle}>전세가율{!loading && jeonseRate !== null && !isSameArea ? ' *' : ''}</span>
        {loading ? (
          <span style={loadingValueStyle}>조회 중</span>
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
        ) : gap !== null ? (
          <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--primary-color)' }}>{gap.toFixed(1)}억</span>
        ) : (
          <span style={emptyValueStyle}>데이터 부족</span>
        )}
      </div>
    </div>
  );
}
