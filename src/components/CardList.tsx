import React from 'react';
import styles from '@/app/page.module.css';
import RankCard, { RankData } from './RankCard';

interface CardListProps {
  title: string;
  titleHighlight: string;
  highlightColor: string;
  date: string;
  data: RankData[];
  isHorizontal?: boolean;
}

const CardList: React.FC<CardListProps> = ({ title, titleHighlight, highlightColor, date, data, isHorizontal }) => {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>
          {title} <span style={{ color: highlightColor }}>{titleHighlight}</span>
        </h2>
        <span className={styles.sectionDate}>{date}</span>
      </div>
      
      <div className={`${isHorizontal ? styles.carouselList : styles.cardList} hide-scrollbar`}>
        {data.map((item) => (
          <RankCard key={item.id} data={item} />
        ))}
      </div>
    </section>
  );
};

export default CardList;
