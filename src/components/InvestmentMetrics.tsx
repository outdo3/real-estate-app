'use client';

import React, { useEffect, useState } from 'react';
import { computeInvestmentMetrics } from '@/lib/investment-metrics';
import {
  resolveTradeReadState,
  resolveDerivedMetricTrust,
  resolveObservedMetricTrust,
  TRADE_DERIVED_SUPPRESSED_MESSAGE,
  TRADE_API_UNAVAILABLE_MESSAGE,
  TRADE_PARTIAL_MESSAGE,
  type TradeReadState,
} from '@/lib/trade-read-state';

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

// MOLIT_PARTIAL_TRUST_V2 §3 — 이 컴포넌트의 네 지표는 원본 불완전성에 대한 민감도가 서로
// 다르다. 실제 원본 의존성을 그대로 반영해 분류한다:
//
//  - 매매가  : 매매(apt) 한 계열의 관측 사실. 빠진 달이 있어도 "이 가격에 거래가 있었다"는
//              참이지만 "가장 최근"이라는 단정은 흔들린다 → QUALIFIED(값 + 단서).
//  - 전세가  : 전월세(rent) 한 계열의 관측 사실 → 동일하게 QUALIFIED.
//  - 전세가율: 전세/매매 — 두 계열의 결합 계산값. 어느 한쪽에서 한 달만 빠져도 비율 자체가
//              달라진다 → SUPPRESSED(숫자를 만들지 않는다).
//  - 필요 갭 : 매매-전세 — 동일하게 두 계열 결합 → SUPPRESSED.
//
// 원본이 완전하면 네 지표 모두 SAFE가 되어 기존 동작/값과 100% 동일하다(§8).
export default function InvestmentMetrics({ aptName, lawdCd, dong, selectedTradeArea }: InvestmentMetricsProps) {
  const [saleState, setSaleState] = useState<TradeReadState<SimpleTrade> | null>(null);
  const [rentState, setRentState] = useState<TradeReadState<SimpleTrade> | null>(null);

  useEffect(() => {
    if (!aptName || !lawdCd) return;
    let cancelled = false;
    setSaleState(null);
    setRentState(null);

    const dongQuery = dong ? `&dong=${encodeURIComponent(dong)}` : '';
    // 예전에는 실패(!res.ok/throw)도 빈 배열로 뭉개져 "데이터 부족"(=진짜 거래 없음)과
    // 구분되지 않았다. 상세/차트가 이미 쓰는 공유 완전성 계약(resolveTradeReadState)을
    // 그대로 써서 실패·부분실패·진짜 0건을 서로 다른 상태로 남긴다(§6 단일 계약).
    const fetchType = async (type: 'apt' | 'rent'): Promise<TradeReadState<SimpleTrade>> => {
      try {
        const res = await fetch(`/api/apt/${encodeURIComponent(aptName)}?lawdCd=${lawdCd}&type=${type}&period=${METRICS_PERIOD_MONTHS}${dongQuery}`);
        const data = res.ok ? await res.json() : null;
        return resolveTradeReadState<SimpleTrade>(res.ok, data);
      } catch (e) {
        return resolveTradeReadState<SimpleTrade>(false, null);
      }
    };

    Promise.all([fetchType('apt'), fetchType('rent')]).then(([sale, rent]) => {
      if (cancelled) return;
      setSaleState(sale);
      setRentState(rent);
    });

    return () => {
      cancelled = true;
    };
  }, [aptName, lawdCd, dong]);

  const loading = saleState === null || rentState === null;

  const isAreaFiltered = !!selectedTradeArea && selectedTradeArea !== '전체';
  // Comparison metrics are meaningful only for one exact raw trade.area — never
  // a Unit Master canonicalExclusiveArea, and never a cross-area fallback.
  const { latestSale, matchedRent, jeonseRate, gap } = computeInvestmentMetrics(
    saleState?.trades ?? [],
    rentState?.trades ?? [],
    selectedTradeArea
  );

  // 단일 계열 관측값은 자기 계열의 완전성만 본다 — 전월세 조회가 실패했다고 매매가를
  // 가릴 이유는 없다(과잉 억제 금지). 결합 계산값만 두 계열을 모두 본다.
  const saleObservedTrust = resolveObservedMetricTrust(saleState);
  const rentObservedTrust = resolveObservedMetricTrust(rentState);
  const combinedTrust = resolveDerivedMetricTrust(saleState, rentState);

  // 전체 실패와 일부 실패는 문구를 구분한다(§7). 두 계열 중 하나라도 전체 실패면
  // 그 사실이 더 강한 상태라 우선한다.
  const incompleteNotice = !loading
    ? (saleState?.apiError || rentState?.apiError)
      ? TRADE_API_UNAVAILABLE_MESSAGE
      : (saleState?.partial || rentState?.partial)
        ? TRADE_PARTIAL_MESSAGE
        : null
    : null;

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
  // 억제 상태 문구는 카드 안에서 두 줄까지 자연스럽게 접히게 둔다(360px에서 한 줄로
  // 강제하면 잘리거나 가로 스크롤이 생긴다).
  const suppressedValueStyle: React.CSSProperties = {
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
    lineHeight: 1.35,
    wordBreak: 'keep-all',
  };
  const qualifierStyle: React.CSSProperties = {
    fontSize: '0.68rem',
    color: '#92400e',
    lineHeight: 1.3,
    wordBreak: 'keep-all',
  };

  // 개별 카드에는 짧은 단서만 붙이고, 이유를 설명하는 긴 문구는 그리드 아래 한 번만
  // 노출한다(§13 "경고 중복 금지").
  const qualifierNote = '일부 기간 미반영';

  const renderObserved = (
    value: string | null,
    trust: typeof saleObservedTrust,
    strong = 700,
    color = 'var(--text-primary)'
  ) => {
    if (loading) return <span style={loadingValueStyle}>조회 중</span>;
    if (!isAreaFiltered) return <span style={emptyValueStyle}>평형 선택 필요</span>;
    // 원본이 불완전할 때의 "값 없음"은 "데이터 부족"(=진짜로 거래가 없음)이 아니다.
    if (value === null) {
      return trust === 'SAFE'
        ? <span style={emptyValueStyle}>데이터 부족</span>
        : <span style={suppressedValueStyle}>{TRADE_DERIVED_SUPPRESSED_MESSAGE}</span>;
    }
    return (
      <>
        <span style={{ fontSize: '0.95rem', fontWeight: strong, color }}>{value}</span>
        {trust !== 'SAFE' && <span style={qualifierStyle}>{qualifierNote}</span>}
      </>
    );
  };

  const renderCombined = (value: string | null, strong = 700) => {
    if (loading) return <span style={loadingValueStyle}>조회 중</span>;
    if (!isAreaFiltered) return <span style={emptyValueStyle}>평형 선택 필요</span>;
    // 결합 계산값은 원본이 불완전하면 값이 나왔더라도 보여주지 않는다 — 빠진 달이
    // 최신 매매/전세를 바꾸면 비율과 갭이 통째로 달라진다.
    if (combinedTrust === 'SUPPRESSED') {
      return <span style={suppressedValueStyle}>{TRADE_DERIVED_SUPPRESSED_MESSAGE}</span>;
    }
    if (value === null) return <span style={emptyValueStyle}>데이터 부족</span>;
    return <span style={{ fontSize: '0.95rem', fontWeight: strong, color: 'var(--primary-color)' }}>{value}</span>;
  };

  return (
    <div style={{ marginTop: '0.85rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
        <div style={cardStyle}>
          <span style={labelStyle}>매매가</span>
          {renderObserved(latestSale ? latestSale.priceStr : null, saleObservedTrust)}
        </div>
        <div style={cardStyle}>
          <span style={labelStyle}>전세가</span>
          {renderObserved(matchedRent ? matchedRent.priceStr : null, rentObservedTrust)}
        </div>
        <div style={cardStyle}>
          <span style={labelStyle}>전세가율</span>
          {renderCombined(jeonseRate !== null ? `${jeonseRate.toFixed(1)}%` : null)}
        </div>
        <div style={highlightCardStyle}>
          <span style={labelStyle}>필요 갭 금액</span>
          {renderCombined(gap !== null ? `${gap.toFixed(1)}억` : null, 800)}
        </div>
      </div>
      {incompleteNotice && (
        <div
          style={{
            marginTop: '0.5rem',
            padding: '0.55rem 0.7rem',
            borderRadius: '8px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            fontSize: '0.72rem',
            lineHeight: 1.45,
            wordBreak: 'keep-all',
          }}
        >
          {incompleteNotice}
        </div>
      )}
    </div>
  );
}
