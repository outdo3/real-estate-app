'use client';

import React from 'react';
import { directionColor, formatTradeCount, isLowSample } from '@/lib/stats-format';
import styles from './RankingRow.module.css';

export interface RankingRowData {
  rank: number;
  name: string;
  /** 동/지역 등 부가 위치 정보(선택). */
  region?: string;
  /** 핵심 지표 표시 문자열(예: "-18%", "12억 5,000만"). */
  metricLabel: string;
  /** 색상 방향 판단용 — 양수면 up-color, 음수면 down-color, null/0이면 중립. */
  metricDirection?: number | null;
  /** [STATISTICS_COLOR_SYSTEM_V1] 신고가/인기단지처럼 값 자체에 부호가 없어
   * metricDirection으로 색을 정할 수 없는 화면을 위한 명시적 오버라이드
   * (CSS var 문자열, 예: 'var(--up-color)'). 지정되면 metricDirection보다
   * 우선한다. */
  valueColor?: string;
  /** 2차 맥락(예: "25평 · 최근 7억 3,500만"). */
  contextLabel?: string;
  tradeCount: number;
}

interface RankingRowProps {
  data: RankingRowData;
  onClick?: () => void;
}

const TOP_RANK_CLASS = [styles.rankTop1, styles.rankTop2, styles.rankTop3];

// [STATISTICS V2 §8] 순위형 통계(decline/record-high/rising/top-traded/
// jeonse-risk) 5개 화면이 공유하는 최소 contract: rank/apartment/region/
// primary metric/secondary context/direction/trade count/detail CTA.
// 이집점수는 여기서 다루지 않는다(§28 — 30건 개별 API 호출은 §42 중복
// fetch 금지 원칙과 충돌, 배치 조회 API가 생기면 다음 STEP에서 추가).
export default function RankingRow({ data, onClick }: RankingRowProps) {
  const { rank, name, region, metricLabel, metricDirection, valueColor, contextLabel, tradeCount } = data;
  const rankClass = rank <= 3 ? TOP_RANK_CLASS[rank - 1] : '';
  const lowSample = isLowSample(tradeCount);

  return (
    <li
      className={styles.item}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && onClick) onClick(); }}
    >
      <div className={[styles.rank, rankClass].filter(Boolean).join(' ')}>{rank}</div>
      <div className={styles.info}>
        <div className={styles.name}>{name}</div>
        <div className={styles.meta}>{[region, contextLabel].filter(Boolean).join(' · ')}</div>
      </div>
      <div className={styles.valueCol}>
        <div className={styles.value} style={{ color: valueColor || directionColor(metricDirection) }}>{metricLabel}</div>
        <div className={[styles.sub, lowSample ? styles.lowSample : ''].filter(Boolean).join(' ')}>
          {lowSample ? `표본 적음 · ${formatTradeCount(tradeCount)}` : formatTradeCount(tradeCount)}
        </div>
      </div>
    </li>
  );
}

export function RankingList({ children }: { children: React.ReactNode }) {
  return <ul className={styles.list}>{children}</ul>;
}
