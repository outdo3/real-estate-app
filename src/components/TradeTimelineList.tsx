import React from 'react';
import { resolveAreaLabel, type DisplayUnit } from '@/lib/area-utils';

interface TimelineTrade {
  id: number;
  tradeDate: string;
  price: number;
  priceStr: string;
  area: string;
  floor: number;
  tradeType: string;
}

interface TradeTimelineListProps {
  trades: TimelineTrade[];
  unitMaster?: DisplayUnit[] | null;
  loading: boolean;
  apiError: string | null;
  visibleCount: number;
  onLoadMore: () => void;
  areaLabels?: Map<number, string>;
}

export default function TradeTimelineList({ trades, loading, apiError, visibleCount, onLoadMore, areaLabels, unitMaster }: TradeTimelineListProps) {
  if (loading) {
    return <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>데이터를 불러오는 중입니다...</div>;
  }
  if (trades.length === 0) {
    return (
      <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        {apiError ? `실거래가 데이터를 불러오지 못했습니다. (${apiError})` : '선택한 조건의 실거래가 없습니다.'}
      </div>
    );
  }

  const visible = trades.slice(0, visibleCount);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {visible.map((t, index) => {
        let areaLabel = resolveAreaLabel(parseFloat(t.area), areaLabels);
        if (unitMaster && unitMaster.length > 0) {
          const unit = unitMaster.find(u => u.canonicalExclusiveArea === t.area);
          if (unit) {
            if (unit.representativePyeong) {
              areaLabel = `${unit.representativePyeong}평`; // In trade list, we can keep it compact (e.g. 34평 or 전용 84.79㎡)
            } else {
              areaLabel = `전용 ${unit.displayExclusiveArea}㎡`;
            }
          }
        }
        const isSale = t.tradeType.includes('매매') || t.tradeType === '실거래';
        const prevTrade = trades[index + 1];
        let diffBadge: React.ReactNode = null;
        if (prevTrade && isSale && prevTrade.area === t.area) {
          const diff = t.price - prevTrade.price;
          if (diff > 0) diffBadge = <span style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 700 }}>▲{diff.toFixed(1)}</span>;
          else if (diff < 0) diffBadge = <span style={{ fontSize: '0.8rem', color: '#3b82f6', fontWeight: 700 }}>▼{Math.abs(diff).toFixed(1)}</span>;
        }

        const dateFormatted = t.tradeDate.replace(/-/g, '.');

        return (
          <div key={`row-${t.id}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.85rem 0', borderBottom: '1px solid var(--border-color)', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{t.priceStr}</span>
                {diffBadge}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {dateFormatted} · {areaLabel}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem', flexShrink: 0 }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{t.floor}층</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.tradeType}</span>
            </div>
          </div>
        );
      })}
      {trades.length > visibleCount && (
        <div style={{ padding: '1rem', textAlign: 'center', marginTop: '0.5rem' }}>
          <button
            onClick={onLoadMore}
            style={{ padding: '0.6rem 1.5rem', borderRadius: '999px', border: '1px solid var(--border-color)', background: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}
          >
            더보기 ({trades.length - visibleCount}건 더 있음)
          </button>
        </div>
      )}
    </div>
  );
}
