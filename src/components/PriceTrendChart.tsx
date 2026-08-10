'use client';

import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface PriceTrendChartProps {
  aptName: string;
  lawdCd: string;
  // 같은 구/군 안에 다른 동의 동일 브랜드 단지(예: "롯데캐슬", "푸르지오")가 있으면
  // 이름만으로는 섞여 조회될 수 있어, 알고 있으면 반드시 넘겨서 정확히 그 동으로 좁힌다.
  dong?: string;
}

interface SimpleTrade {
  price: number;
  priceStr: string;
  area: string;
  tradeDate: string;
  monthlyRent?: number;
}

interface ChartPoint {
  id: number;
  date: string;
  salePrice: number | null;
  saleStr: string | null;
  rentPrice: number | null;
  rentStr: string | null;
}

const PERIODS: Record<'1년' | '3년' | '5년', number> = { '1년': 12, '3년': 36, '5년': 60 };

// InvestmentMetrics와 같은 자기완결형 패턴 — 부모의 tradeTypeFilter(매매/전월세 단일 선택)와
// 무관하게 매매·전세 두 시계열을 동시에 조회해 겹쳐 그린다. "매매/전세 시세 추이 차트"는
// 두 값을 동시에 비교하는 게 핵심이라 부모의 단일 필터 상태에 얹기보다 독립시키는 편이 안전하다.
export default function PriceTrendChart({ aptName, lawdCd, dong }: PriceTrendChartProps) {
  const [saleTrades, setSaleTrades] = useState<SimpleTrade[] | null>(null);
  const [rentTrades, setRentTrades] = useState<SimpleTrade[] | null>(null);
  const [period, setPeriod] = useState<'1년' | '3년' | '5년'>('3년');

  useEffect(() => {
    if (!aptName || !lawdCd) return;
    let cancelled = false;
    setSaleTrades(null);
    setRentTrades(null);

    const months = PERIODS[period];
    const dongQuery = dong ? `&dong=${encodeURIComponent(dong)}` : '';
    const fetchType = async (type: 'apt' | 'rent'): Promise<SimpleTrade[]> => {
      try {
        const res = await fetch(`/api/apt/${encodeURIComponent(aptName)}?lawdCd=${lawdCd}&type=${type}&period=${months}${dongQuery}`);
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
      // 갭/전세가율과 동일하게 순수 전세(월세 없음)만 추이에 반영 — 월세가 섞이면 보증금 규모가
      // 달라 같은 축에서 매매가와 비교할 수 없다.
      setRentTrades(rent.filter((r) => (r.monthlyRent ?? 0) === 0));
    });

    return () => {
      cancelled = true;
    };
  }, [aptName, lawdCd, period, dong]);

  const loading = saleTrades === null || rentTrades === null;

  const chartData: ChartPoint[] = (() => {
    if (!saleTrades || !rentTrades) return [];
    const merged = [
      ...saleTrades.map((t) => ({ date: t.tradeDate, salePrice: t.price, saleStr: t.priceStr, rentPrice: null as number | null, rentStr: null as string | null })),
      ...rentTrades.map((t) => ({ date: t.tradeDate, salePrice: null as number | null, saleStr: null as string | null, rentPrice: t.price, rentStr: t.priceStr })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return merged.map((p, i) => ({ id: i, ...p }));
  })();

  const hasData = chartData.length > 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>매매/전세 시세 추이</h3>
        <div style={{ display: 'flex', background: 'var(--bg-color)', borderRadius: '4px', padding: '0.25rem' }}>
          {(['1년', '3년', '5년'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '0.25rem 0.6rem',
                border: 'none',
                background: period === p ? 'white' : 'transparent',
                fontWeight: period === p ? 700 : 400,
                borderRadius: '4px',
                cursor: 'pointer',
                boxShadow: period === p ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          데이터를 불러오는 중입니다...
        </div>
      ) : !hasData ? (
        <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          해당 기간의 매매/전세 거래 내역이 없습니다.
        </div>
      ) : (
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
              <XAxis
                dataKey="id"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                tickFormatter={(id) => chartData[id]?.date.substring(2, 7) || ''}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                tickFormatter={(val) => (val >= 1 ? `${val}억` : `${Math.round(val * 10000)}만`)}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const data = payload[0].payload as ChartPoint;
                  return (
                    <div style={{ backgroundColor: 'white', padding: '10px 12px', border: '1px solid #eee', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                      <p style={{ margin: '0 0 6px 0', fontSize: '0.8rem', color: '#666' }}>{data.date.replace(/-/g, '.')}</p>
                      {data.saleStr && <p style={{ margin: 0, fontWeight: 700, color: 'var(--primary-color)' }}>매매 {data.saleStr}</p>}
                      {data.rentStr && <p style={{ margin: 0, fontWeight: 700, color: '#10b981' }}>전세 {data.rentStr}</p>}
                    </div>
                  );
                }}
              />
              <Legend formatter={(value) => (value === 'salePrice' ? '매매' : '전세')} />
              <Line type="monotone" dataKey="salePrice" name="salePrice" stroke="var(--primary-color)" strokeWidth={2.5} dot={false} connectNulls />
              <Line type="monotone" dataKey="rentPrice" name="rentPrice" stroke="#10b981" strokeWidth={2.5} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
