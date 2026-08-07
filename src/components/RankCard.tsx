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
}

const RankCard: React.FC<RankCardProps> = ({ data }) => {
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
  const detailUrl = `/apt/${encodeURIComponent(data.name)}?type=${type}&lawdCd=${lawdCd}`;

  const formatPrice = (priceStr: string) => {
    return priceStr;
  };

  const formatInfo = (infoStr: string) => {
    const match = infoStr.match(/([\d.]+)m²/);
    if (match) {
      const pyung = Math.round(parseFloat(match[1]) / 3.3058);
      return infoStr.replace(match[0], `${match[0]} ${pyung}평`);
    }
    return infoStr;
  };

  const router = require('next/navigation').useRouter();

  return (
    <article 
      className={`${styles.card} hover-scale`} 
      onClick={() => router.push(detailUrl)}
      style={{ cursor: 'pointer', flexShrink: 0, width: '280px', scrollSnapAlign: 'start', transition: 'transform 0.2s, box-shadow 0.2s' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 12px 24px -10px rgba(0, 0, 0, 0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)';
      }}
    >
      <h3 className={styles.cardTitle}>{data.name}</h3>
      <div className={styles.cardPrice}>{formatPrice(data.price)}</div>
      <div className={styles.cardMeta} style={{ marginBottom: '0.75rem' }}>
        <span className={`${styles.badge} ${getBadgeClass(data.changeType)}`}>
          {data.typeLabel} {data.priceChange}
        </span>
      </div>
      <div className={styles.cardInfo} style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>{formatInfo(data.info)}</div>
    </article>
  );
};

export default RankCard;
