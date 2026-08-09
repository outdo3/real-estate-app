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

  const sortedRent = rentTrades ? [...rentTrades].sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime()) : [];
  const matchedRent = latestSale
    ? sortedRent.find((r) => r.area === latestSale.area) || (sortedRent.length > 0 ? sortedRent[0] : null)
    : null;

  const isSameArea = !!(latestSale && matchedRent && matchedRent.area === latestSale.area);
  const gap = latestSale && matchedRent ? latestSale.price - matchedRent.price : null;
  const jeonseRate = latestSale && matchedRent && latestSale.price > 0 ? (matchedRent.price / latestSale.price) * 100 : null;

  const cardStyle: React.CSSProperties = {
    flex: '1 1 160px',
    padding: '1rem',
    borderRadius: '12px',
    backgroundColor: '#f8fafc',
    border: '1px solid var(--border-color)',
  };

  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
      <div style={cardStyle}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>전세가율</div>
        {loading ? (
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-muted)' }}>조회 중...</div>
        ) : jeonseRate !== null ? (
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--primary-color)' }}>{jeonseRate.toFixed(1)}%</div>
        ) : (
          <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>최근 6개월 데이터 부족</div>
        )}
        {!loading && jeonseRate !== null && !isSameArea && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>* 동일 평형 매물이 없어 다른 평형의 최근 거래 기준으로 계산(참고용)</div>
        )}
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>갭 금액 (매매-전세)</div>
        {loading ? (
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-muted)' }}>조회 중...</div>
        ) : gap !== null ? (
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>{gap.toFixed(1)}억</div>
        ) : (
          <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>최근 6개월 데이터 부족</div>
        )}
      </div>
    </div>
  );
}
