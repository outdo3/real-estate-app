import React from 'react';
import styles from '@/app/page.module.css';
import Link from 'next/link';

export interface RankData {
  id: string;
  rank: number;
  name: string;
  price: string;
  priceChange: string;
  changeType: 'up' | 'down' | 'new';
  typeLabel: string;
  info: string;
  dong?: string;
  lat?: number | null;
  lng?: number | null;
}

interface RankCardProps {
  data: RankData;
  regionName?: string;
}

const RankCard: React.FC<RankCardProps> = ({ data, regionName }) => {
  const getRankClass = (rank: number) => {
    switch (rank) {
      case 1: return styles.rank1;
      case 2: return styles.rank2;
      case 3: return styles.rank3;
      default: return styles.rankOther;
    }
  };

  const getBadgeClass = (changeType: string) => {
    return changeType === 'up' || changeType === 'new' ? styles.badgeUp : '';
  };

  const idStr = String(data.id || '');
  const parts = idStr.split('-');
  const type = parts.length > 1 ? parts[0] : 'apt';
  const lawdCd = parts.length > 1 ? parts[1] : '11680'; // fallback
  let detailUrl = `/apt/${encodeURIComponent(data.name)}?type=${type}&lawdCd=${lawdCd}`;
  if (regionName) {
    detailUrl += `&region=${encodeURIComponent(regionName)}`;
  }
  if (data.dong) {
    detailUrl += `&dong=${encodeURIComponent(data.dong)}`;
  }

  const formatPrice = (priceStr: string) => {
    return priceStr;
  };

  const formatInfo = (infoStr: string) => {
    const match = infoStr.match(/([\d.]+)m²/);
    if (match) {
      const sqmt = parseFloat(match[1]);
      const formattedSqmt = sqmt.toFixed(1).replace(/\.0$/, ''); // 59.7813 -> 59.8, 84.000 -> 84
      const pyung = Math.round(sqmt / 3.3058);
      return infoStr.replace(match[0], `${formattedSqmt}m² (${pyung}평)`);
    }
    return infoStr;
  };

  const router = require('next/navigation').useRouter();

  return (
    <article 
      className={`${styles.card} hover-scale`} 
      onClick={() => router.push(detailUrl)}
      style={{ cursor: 'pointer', scrollSnapAlign: 'start', transition: 'transform 0.2s, box-shadow 0.2s' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 12px 24px -10px rgba(0, 0, 0, 0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)';
      }}
    >
      <div className={styles.cardTop}>
        <h3 className={styles.cardTitle}>{data.name}</h3>
        <div className={styles.cardPrice}>{formatPrice(data.price)}</div>
      </div>
      <div className={styles.cardBottom}>
        <div className={styles.cardMeta}>
          <span className={`${styles.badge} ${getBadgeClass(data.changeType)}`}>
            {data.typeLabel} {data.priceChange}
          </span>
        </div>
        <div className={styles.cardInfo}>{formatInfo(data.info)}</div>
      </div>
    </article>
  );
};

export default RankCard;
