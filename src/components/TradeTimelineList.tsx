import React from 'react';
import { resolveAreaLabel } from '@/lib/area-utils';

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
  loading: boolean;
  apiError: string | null;
  visibleCount: number;
  onLoadMore: () => void;
  // 부모가 이 단지의 전체 거래 기준으로 만든 충돌 해소 라벨 맵 — AreaSelector 칩과
  // 같은 라벨을 쓴다. filteredTrades만 보고 이 컴포넌트 안에서 새로 계산하면
  // (평형이 이미 선택된 상태에서는 이 목록에 한 종류 면적만 남아 충돌을 판단할
  // 자체 근거가 없어져) 칩과 다른 라벨이 나올 수 있어 반드시 상위에서 전달받는다.
  areaLabels?: Map<number, string>;
}

// 2구역 "최근 실거래가" 테이블. 모바일 한 화면에 좌우 스크롤 없이 다 들어오도록 컬럼을
// 계약월/일/가격/타입 4개로 최소화했다(등기 정보·거래동 컬럼은 요청에 따라 제거).
export default function TradeTimelineList({ trades, loading, apiError, visibleCount, onLoadMore, areaLabels }: TradeTimelineListProps) {
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
    padding: '0.4rem 0.3rem',
    fontSize: '0.78rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textAlign: 'left',
    borderBottom: '1px solid var(--border-color)',
    whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: '0.5rem 0.3rem',
    fontSize: '0.82rem',
    color: 'var(--text-primary)',
    borderBottom: '1px solid #f1f5f9',
    whiteSpace: 'nowrap',
  };

  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '22%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '36%' }} />
          <col style={{ width: '28%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={thStyle}>계약월</th>
            <th style={thStyle}>일</th>
            <th style={thStyle}>가격</th>
            <th style={thStyle}>타입</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((t, index) => {
            const areaLabel = resolveAreaLabel(parseFloat(t.area), areaLabels);
            const isSale = t.tradeType.includes('매매') || t.tradeType === '실거래';
            const prevTrade = trades[index + 1];
            let diffBadge: React.ReactNode = null;
            if (prevTrade && isSale && prevTrade.area === t.area) {
              const diff = t.price - prevTrade.price;
              if (diff > 0) diffBadge = <span style={{ fontSize: '0.72rem', marginLeft: '0.25rem', color: '#ef4444', fontWeight: 700 }}>▲{diff.toFixed(1)}</span>;
              else if (diff < 0) diffBadge = <span style={{ fontSize: '0.72rem', marginLeft: '0.25rem', color: '#3b82f6', fontWeight: 700 }}>▼{Math.abs(diff).toFixed(1)}</span>;
            }

            const [ymPart, dPart] = t.tradeDate.split('-').length === 3
              ? [t.tradeDate.slice(0, 7).replace('-', '.'), t.tradeDate.slice(8, 10)]
              : [t.tradeDate, ''];

            return (
              <tr key={`row-${t.id}`}>
                <td style={tdStyle}>{ymPart}</td>
                <td style={tdStyle}>{dPart ? `${dPart}일` : '-'}</td>
                <td style={{ ...tdStyle, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <b>{t.priceStr}</b>{diffBadge}
                </td>
                <td style={{ ...tdStyle, overflow: 'hidden', textOverflow: 'ellipsis' }}>{areaLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
