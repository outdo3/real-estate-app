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
  dong?: string;
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

// 2구역 "최근 실거래가" 테이블. 아실 스타일로 계약월/일을 별도 컬럼으로 쪼개 압축했다.
// 등기 여부는 실제 MOLIT 상세 API 필드(등기일자/해제여부)를 그대로 보여준다 — 등기일자가
// 비어 있으면 "미등기"로 단정하지 않고 "-"로만 표시해 실제 미등기 상태와 API가 값을
// 안 채워준 경우를 혼동하지 않게 한다.
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

  const visible = trades.slice(0, visibleCount);

  const thStyle: React.CSSProperties = {
    padding: '0.5rem 0.6rem',
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textAlign: 'left',
    borderBottom: '1px solid var(--border-color)',
    whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: '0.55rem 0.6rem',
    fontSize: '0.85rem',
    color: 'var(--text-primary)',
    borderBottom: '1px solid #f1f5f9',
    whiteSpace: 'nowrap',
  };

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>계약월</th>
              <th style={thStyle}>일</th>
              <th style={thStyle}>정보(등기)</th>
              <th style={thStyle}>가격</th>
              <th style={thStyle}>타입(전용)</th>
              <th style={thStyle}>거래동</th>
              <th style={thStyle}>층</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, index) => {
              const areaInfo = getAreaInfo(parseFloat(t.area));
              const isSale = t.tradeType.includes('매매') || t.tradeType === '실거래';
              const prevTrade = trades[index + 1];
              let diffBadge: React.ReactNode = null;
              if (prevTrade && isSale && prevTrade.area === t.area) {
                const diff = t.price - prevTrade.price;
                if (diff > 0) diffBadge = <span style={{ fontSize: '0.7rem', marginLeft: '0.35rem', color: '#ef4444', fontWeight: 700 }}>▲{diff.toFixed(1)}</span>;
                else if (diff < 0) diffBadge = <span style={{ fontSize: '0.7rem', marginLeft: '0.35rem', color: '#3b82f6', fontWeight: 700 }}>▼{Math.abs(diff).toFixed(1)}</span>;
              }

              let registryLabel: React.ReactNode = <span style={{ color: 'var(--text-muted)' }}>-</span>;
              if (isSale) {
                if (t.dealCanceled) {
                  registryLabel = <span style={{ color: '#dc2626', fontWeight: 600 }}>해제</span>;
                } else if (t.registryDate) {
                  registryLabel = <span style={{ color: '#16a34a', fontWeight: 600 }}>등기 {t.registryDate}</span>;
                }
              }

              const [ymPart, dPart] = t.tradeDate.split('-').length === 3
                ? [t.tradeDate.slice(0, 7).replace('-', '.'), t.tradeDate.slice(8, 10)]
                : [t.tradeDate, ''];

              return (
                <tr key={`row-${t.id}`}>
                  <td style={tdStyle}>{ymPart}</td>
                  <td style={tdStyle}>{dPart ? `${dPart}일` : '-'}</td>
                  <td style={tdStyle}>{registryLabel}</td>
                  <td style={tdStyle}>
                    <b>{t.priceStr}</b>{diffBadge}
                  </td>
                  <td style={tdStyle}>{areaInfo.exclusiveM2 ? `${areaInfo.exclusiveM2}㎡(${areaInfo.exclusivePyung}평)` : '-'}</td>
                  <td style={tdStyle}>{t.dong || '-'}</td>
                  <td style={tdStyle}>{t.floor}층</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
