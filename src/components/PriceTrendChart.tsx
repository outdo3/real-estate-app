'use client';

import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface PriceTrendChartProps {
  aptName: string;
  lawdCd: string;
  // 같은 구/군 안에 다른 동의 동일 브랜드 단지(예: "롯데캐슬", "푸르지오")가 있으면
  // 이름만으로는 섞여 조회될 수 있어, 알고 있으면 반드시 넘겨서 정확히 그 동으로 좁힌다.
  dong?: string;
  // 부모(apt-client.tsx)의 AreaSelector 선택값(원본 area 문자열, 기본 '전체'). Hero/
  // 실거래 타임라인과 같은 내부 key를 그대로 받아 이 차트도 같은 평형 기준으로 필터링한다
  // (B2-3). '전체'거나 넘기지 않으면 기존(B2-2 이전과 동일) 전체 평형 동작을 그대로 유지.
  selectedArea?: string;
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

// recharts <Line connectNulls>는 같은 dataKey에 유효(non-null)한 점이 최소 2개는 있어야
// 선분을 그린다 — 1개 이하면 dot={false}와 맞물려 화면에 아무것도 안 보인다(값은 있는데
// 빈 차트처럼 보임). 그래서 "추이를 그릴 수 있는 최소 단위"를 월별 집계가 아니라 이
// 렌더링 제약 자체로 판단한다: 현재 구현은 개별 거래를 그대로 점으로 찍고(집계 없음,
// x축도 실제 날짜가 아닌 정렬된 순번) 있어 "거래 건수 = 차트 점 개수"가 정확히 1:1이라,
// 원본 거래 건수를 그대로 이 기준에 써도 왜곡이 없다.
const MIN_TREND_POINTS = 2;

// InvestmentMetrics와 같은 자기완결형 패턴 — 부모의 tradeTypeFilter(매매/전월세 단일 선택)와
// 무관하게 매매·전세 두 시계열을 동시에 조회해 겹쳐 그린다. "매매/전세 시세 추이 차트"는
// 두 값을 동시에 비교하는 게 핵심이라 부모의 단일 필터 상태에 얹기보다 독립시키는 편이 안전하다.
export default function PriceTrendChart({ aptName, lawdCd, dong, selectedArea }: PriceTrendChartProps) {
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

  // selectedArea가 '전체'거나 안 넘어오면 추가 네트워크 호출 없이(§25) 이미 받아온
  // saleTrades/rentTrades를 그대로 쓴다 — B2-2 이전과 완전히 동일한 결과(회귀 없음).
  // 특정 평형이면 원본 area 문자열(내부 key, 표시 라벨 아님)이 정확히 일치하는 거래만
  // 남긴다. 매매/전세를 각각 독립적으로 필터링해서, 한쪽만 데이터가 부족해도 다른 쪽까지
  // 함께 비워지지 않는다.
  const isAreaFiltered = !!selectedArea && selectedArea !== '전체';
  const saleForChart = isAreaFiltered ? (saleTrades?.filter((t) => t.area === selectedArea) ?? null) : saleTrades;
  const rentForChart = isAreaFiltered ? (rentTrades?.filter((t) => t.area === selectedArea) ?? null) : rentTrades;

  const chartData: ChartPoint[] = (() => {
    if (!saleForChart || !rentForChart) return [];
    const merged = [
      ...saleForChart.map((t) => ({ date: t.tradeDate, salePrice: t.price, saleStr: t.priceStr, rentPrice: null as number | null, rentStr: null as string | null })),
      ...rentForChart.map((t) => ({ date: t.tradeDate, salePrice: null as number | null, saleStr: null as string | null, rentPrice: t.price, rentStr: t.priceStr })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return merged.map((p, i) => ({ id: i, ...p }));
  })();

  const hasData = chartData.length > 0;

  // 다른 평형(예: 전체) 데이터를 몰래 대신 보여주는 것은 금지 — 대신 선택 평형 기준으로만
  // 필터링한 뒤, 그 결과가 너무 적어 선(추이)을 그리지 못할 때만 이유를 짧게 안내한다.
  // 매매/전세를 독립적으로 판단해서 한쪽만 부족해도 그 series만 언급한다.
  const saleThin = isAreaFiltered && (saleForChart?.length ?? 0) < MIN_TREND_POINTS;
  const rentThin = isAreaFiltered && (rentForChart?.length ?? 0) < MIN_TREND_POINTS;
  const thinDataNote = !loading && hasData && isAreaFiltered && (saleThin || rentThin)
    ? (saleThin && rentThin
        ? '선택 평형은 매매·전세 거래가 모두 적어 추이를 표시하기 어렵습니다.'
        : saleThin
        ? '선택 평형은 매매 거래가 적어 추이를 표시하기 어렵습니다.'
        : '선택 평형은 전세 거래가 적어 추이를 표시하기 어렵습니다.')
    : null;

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

      {thinDataNote && (
        <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {thinDataNote}
        </div>
      )}

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
                      {/* #3152d6은 globals.css의 --down-color와 같은 파랑이지만, 그 변수 자체는
                          "가격 하락"(등락) 의미로 다른 화면(ai-search 통계)에서 쓰이고 있어 여기서는
                          변수명 대신 같은 hex를 직접 써서 "전세 시리즈 색" 의미로만 한정한다. */}
                      {data.rentStr && <p style={{ margin: 0, fontWeight: 700, color: '#3152d6' }}>전세 {data.rentStr}</p>}
                    </div>
                  );
                }}
              />
              <Legend formatter={(value) => (value === 'salePrice' ? '매매' : '전세')} />
              <Line type="monotone" dataKey="salePrice" name="salePrice" stroke="var(--primary-color)" strokeWidth={2.5} dot={false} connectNulls />
              {/* 매매(초록)와 구분되도록 --down-color와 동일한 파랑 계열 사용(위 tooltip 주석 참고) */}
              <Line type="monotone" dataKey="rentPrice" name="rentPrice" stroke="#3152d6" strokeWidth={2.5} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
