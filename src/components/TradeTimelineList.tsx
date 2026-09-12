import React from 'react';
import { resolveAreaLabel, type DisplayUnit } from '@/lib/area-utils';
import { areaMatchesSelection, findUnitForArea } from '@/lib/unit-area-match';
import { canCollapseTrades, canExpandTrades, visibleTrades } from '@/lib/apt-detail/trade-rows';

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
  // APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX — 원본 오류 문자열이 아니라 이미 사용자용
  // 으로 정리된 문구를 받는다(trade-read-state.ts). 전체 실패든 일부 기간 실패든, 이 값이
  // 있으면 목록을 "완전한 결과"로 보여주지 않는다. 값이 없을 때만 "거래 없음"이라고 말한다.
  incompleteMessage: string | null;
  visibleCount: number;
  /** APT_DETAIL_PARTNER_TRADE_DENSITY_V1 §13/§14 — 접힌 상태의 행 수. 지금보다
   *  많이 보이고 있으면 "접기"가 나타난다. */
  collapsedCount?: number;
  onLoadMore: () => void;
  /** 접기. 없으면 접기 버튼을 렌더하지 않는다(기존 호출부 동작 유지). */
  onCollapse?: () => void;
  areaLabels?: Map<number, string>;
}

export default function TradeTimelineList({ trades, loading, incompleteMessage, visibleCount, collapsedCount, onLoadMore, onCollapse, areaLabels, unitMaster }: TradeTimelineListProps) {
  if (loading) {
    return <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>데이터를 불러오는 중입니다...</div>;
  }
  if (trades.length === 0) {
    return (
      <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        {incompleteMessage ?? '선택한 조건의 실거래가 없습니다.'}
      </div>
    );
  }

  const visible = visibleTrades(trades, visibleCount);
  // 더 볼 게 남아 있을 때만 더보기. 접기는 접힌 기준보다 많이 펼쳐져 있을 때만.
  const canExpand = canExpandTrades(trades.length, visibleCount);
  const canCollapse = !!onCollapse && collapsedCount !== undefined && canCollapseTrades(visibleCount, collapsedCount);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {incompleteMessage && (
        <div
          role="status"
          style={{
            padding: '0.7rem 0.85rem',
            marginBottom: '0.75rem',
            borderRadius: '8px',
            border: '1px solid #fcd34d',
            backgroundColor: '#fffbeb',
            color: '#92400e',
            fontSize: '0.85rem',
            lineHeight: 1.5,
          }}
        >
          {incompleteMessage} 아래 목록은 불러온 기간만 반영한 결과입니다.
        </div>
      )}
      {visible.map((t, index) => {
        let areaLabel = resolveAreaLabel(parseFloat(t.area), areaLabels);
        if (unitMaster && unitMaster.length > 0) {
          // suffix("m²") 때문에 문자열 === 가 항상 실패해 평형 라벨이 빠지던 자리.
          const unit = findUnitForArea(unitMaster, t.area);
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
        if (prevTrade && isSale && areaMatchesSelection(prevTrade.area, t.area)) {
          const diff = t.price - prevTrade.price;
          if (diff > 0) diffBadge = <span style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 700 }}>▲{diff.toFixed(1)}</span>;
          else if (diff < 0) diffBadge = <span style={{ fontSize: '0.8rem', color: '#3b82f6', fontWeight: 700 }}>▼{Math.abs(diff).toFixed(1)}</span>;
        }

        const dateFormatted = t.tradeDate.replace(/-/g, '.');

        return (
          // APT_DETAIL_MOBILE_DENSITY_ACTION_BAR_V1 §7 — 행 높이를 줄인다.
          //
          // 데이터는 하나도 빼지 않았다(가격/증감/날짜/평형/층/거래유형 그대로).
          // 줄인 것은 **여백뿐**이다: 위아래 패딩 13.6px씩 → 8.8px씩, 줄 사이 간격
          // 4px → 2.4px. 여기에 줄간격을 명시해 폰트가 기본으로 만들던 여유를 걷어낸다
          // (명시하지 않으면 브라우저 기본 line-height가 글자마다 다른 슬랙을 만든다).
          //
          // 가격은 그대로 가장 강하다(§17) — 크기를 줄이지 않았다.
          <div key={`row-${t.id}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.55rem 0', borderBottom: '1px solid var(--border-color)', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.2 }}>{t.priceStr}</span>
                {diffBadge}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                {dateFormatted} · {areaLabel}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem', flexShrink: 0 }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.2 }}>{t.floor}층</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>{t.tradeType}</span>
            </div>
          </div>
        );
      })}
      {/* APT_DETAIL_PARTNER_TRADE_DENSITY_V1 §13/§14 — 더보기 / 접기.
          목록은 이미 전부 클라이언트에 있고(이 컴포넌트는 trades를 slice만 한다),
          펼치고 접는 데 추가 조회가 없다 — 즉시 반응하며 "데이터가 없습니다"가
          잠깐 스치는 일이 생기지 않는다(§17). 정렬도 범위도 건드리지 않는다(§15). */}
      {(canExpand || canCollapse) && (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', padding: '0.75rem 1rem' }}>
          {canExpand && (
            <button
              onClick={onLoadMore}
              aria-label="최근 실거래 더보기"
              style={{ minHeight: 44, padding: '0.6rem 1.5rem', borderRadius: '999px', border: '1px solid var(--border-color)', background: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}
            >
              더보기 ({trades.length - visibleCount}건 더 있음)
            </button>
          )}
          {canCollapse && (
            <button
              onClick={onCollapse}
              aria-label="최근 실거래 접기"
              style={{ minHeight: 44, padding: '0.6rem 1.5rem', borderRadius: '999px', border: '1px solid var(--border-color)', background: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-secondary)' }}
            >
              접기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
