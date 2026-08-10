import React from 'react';
import { getAreaInfo } from '@/lib/area-utils';

interface TimelineTrade {
  id: number;
  tradeDate: string;
  price: number;
  priceStr: string;
  area: string;
  floor: number;
  tradeType: string;
  registryDate?: string;
  dealCanceled?: boolean;
}

interface TradeTimelineListProps {
  trades: TimelineTrade[];
  loading: boolean;
  apiError: string | null;
  visibleCount: number;
  onLoadMore: () => void;
}

// 2구역 "최근 실거래가 목록" 타임라인. apt-client.tsx의 기존 인라인 렌더링을 그대로 옮기고,
// 실제 MOLIT 상세 API 필드(등기일자/해제여부)로 등기 여부 배지만 추가했다 — 이 배지는 추정이
// 아니라 원본 데이터 유무를 그대로 보여준다(등기일자가 비어 있으면 "미등기"가 아니라 "등기 정보
// 없음"으로 표시해, 실제 미등기 상태와 API가 값을 안 채워준 경우를 혼동하지 않게 한다).
export default function TradeTimelineList({ trades, loading, apiError, visibleCount, onLoadMore }: TradeTimelineListProps) {
  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>데이터를 불러오는 중입니다...</div>;
  }
  if (trades.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        {apiError ? `실거래가 데이터를 불러오지 못했습니다. (${apiError})` : '거래 내역이 없습니다.'}
      </div>
    );
  }

  return (
    <>
      {trades.slice(0, visibleCount).map((t, index) => {
        const areaInfo = getAreaInfo(parseFloat(t.area));
        const isSale = t.tradeType.includes('매매') || t.tradeType === '실거래';
        const prevTrade = trades[index + 1];
        let diffBadge = null;
        if (prevTrade && isSale && prevTrade.area === t.area) {
          const diff = t.price - prevTrade.price;
          if (diff > 0) diffBadge = <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '12px', background: '#fee2e2', color: '#ef4444', fontWeight: 'bold' }}>▲ {diff.toFixed(1)}억</span>;
          else if (diff < 0) diffBadge = <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '12px', background: '#e0e7ff', color: '#3b82f6', fontWeight: 'bold' }}>▼ {Math.abs(diff).toFixed(1)}억</span>;
        }

        let registryBadge = null;
        if (isSale) {
          if (t.dealCanceled) {
            registryBadge = <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', background: '#fef2f2', color: '#dc2626', fontWeight: 600 }}>계약 해제</span>;
          } else if (t.registryDate) {
            registryBadge = <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', background: '#f0fdf4', color: '#16a34a', fontWeight: 600 }}>등기 완료 ({t.registryDate})</span>;
          }
        }

        return (
          <div key={`card-${t.id}`} style={{ padding: '1rem', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
              <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem', backgroundColor: isSale ? '#e0e7ff' : '#dcfce3', color: isSale ? '#3b82f6' : '#10b981' }}>
                {t.tradeType.replace('아파트 ', '')}
              </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t.tradeDate}</span>
              {diffBadge}
              {registryBadge}
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              {areaInfo.label} · <b>{t.priceStr}</b> · {t.floor}층
            </div>
          </div>
        );
      })}
      {trades.length > visibleCount && (
        <div style={{ padding: '1rem', textAlign: 'center' }}>
          <button
            onClick={onLoadMore}
            style={{ padding: '0.6rem 1.5rem', borderRadius: '999px', border: '1px solid var(--border-color)', background: 'white', fontWeight: 600, cursor: 'pointer' }}
          >
            더보기 ({trades.length - visibleCount}건 더 있음)
          </button>
        </div>
      )}
    </>
  );
}
