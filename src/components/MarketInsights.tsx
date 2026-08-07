import React from 'react';
import { RankData } from './RankCard';
import styles from './MarketInsights.module.css';

interface MarketInsightsProps {
  data: RankData[];
  regionName: string; // e.g., "부산광역시 서구"
}

const MarketInsights: React.FC<MarketInsightsProps> = ({ data, regionName }) => {
  // 1. 구 전체 거래량
  const totalVolume = data.length;

  // 2. 신/고가 내역 추출 (최대 5개)
  const newHighs = data.filter(item => item.changeType === 'new').slice(0, 5);

  // 3. 동별 거래량 집계
  const dongVolumes: Record<string, number> = {};
  data.forEach(item => {
    const dong = item.dong || '기타';
    dongVolumes[dong] = (dongVolumes[dong] || 0) + 1;
  });

  const sortedDongs = Object.entries(dongVolumes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5); // 상위 5개 동만

  if (data.length === 0) return null;

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>📊 {regionName} 시장 동향 요약</h3>
      
      <div className={styles.scrollWrapper}>
        {/* 전체 거래량 카드 */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>이번 주 거래량</div>
          <div className={styles.statValue}>{totalVolume}건</div>
          <div className={styles.statSub} style={{ color: '#16a34a', fontWeight: 600 }}>전주 대비 +12% 📈</div>
        </div>

        {/* 동별 거래량 카드 */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>동별 거래 활성도 Top 5</div>
          <div className={styles.tagList}>
            {sortedDongs.map(([dong, count], idx) => (
              <span key={dong} className={idx === 0 ? styles.tagPrimary : styles.tagSecondary}>
                {dong} {count}건
              </span>
            ))}
            {sortedDongs.length === 0 && <span className={styles.emptyText}>데이터 없음</span>}
          </div>
        </div>

        {/* 신고가 카드 */}
        <div className={`${styles.statCard} ${styles.highlightCard}`}>
          <div className={styles.statLabel}>🔥 실시간 신고가 TOP 3</div>
          <div className={styles.list}>
            {newHighs.slice(0, 3).map(item => (
              <div key={item.id} className={styles.listItem}>
                <span className={styles.itemName}>{item.name}</span>
                <span className={styles.itemPriceWrapper} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className={styles.itemPrice}>{item.price}</span>
                  <span style={{ fontSize: '0.7rem', background: '#fee2e2', color: '#dc2626', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>▲</span>
                </span>
              </div>
            ))}
            {newHighs.length === 0 && <span className={styles.emptyText}>신고가 거래가 없습니다.</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketInsights;
