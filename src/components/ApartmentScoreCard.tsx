'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './ApartmentScoreCard.module.css';
import type { ApartmentScoreApiResponse } from '@/lib/apartment-score/client-types';

interface ApartmentScoreCardProps {
  result: ApartmentScoreApiResponse | null;
  loading: boolean;
}

// STEP SCORE S3 — Hero 직후, 실거래 타임라인 직전에 배치하는 이집점수 카드.
// client에는 이 API 응답 JSON만 사용한다 — weight/peer-group/percentile/regional
// formula는 이 컴포넌트 어디에도 없다(§11, server/ 디렉토리를 import하지 않음).
export default function ApartmentScoreCard({ result, loading }: ApartmentScoreCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className={styles.card}>
        <div className={styles.skeletonLine} style={{ width: '35%', height: '1rem' }} />
        <div className={styles.skeletonLine} style={{ width: '20%', height: '2.5rem', marginTop: '0.5rem' }} />
        <div className={styles.skeletonLine} style={{ width: '90%', height: '2.5rem', marginTop: '0.75rem' }} />
      </div>
    );
  }

  // score=null 또는 status!=='OK' — 데이터 부족을 API 오류처럼 취급하지 않고 정직하게
  // 안내한다(§7). 0점 표기 절대 금지, 큰 빈 카드도 만들지 않는다(§24).
  if (!result || result.status !== 'OK' || result.score == null) {
    return (
      <div className={styles.cardCompact}>
        <span className={styles.titleSmall}>이집점수</span>
        <span className={styles.unavailableText}>점수 산정 준비 중입니다.</span>
      </div>
    );
  }

  const { score, categories, regionalStrengths } = result;
  const visibleCategories = categories.filter((c) => c.score != null);
  const withExplanation = categories.filter((c) => c.explanation);

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.title}>이집점수</span>
        <span className={styles.betaBadge}>Beta</span>
      </div>

      <div className={styles.scoreRow}>
        <span className={styles.scoreNumber}>{Math.round(score)}</span>
        <span className={styles.scoreScale}>/100</span>
        <span className={styles.scoreSubtitle}>지역 비교 기준</span>
      </div>

      <p className={styles.caption}>실제 단지·생활·교통 데이터를 주변 비교 단지와 비교한 점수입니다.</p>

      {visibleCategories.length > 0 && (
        <div className={styles.categoryRow}>
          {categories.map((c) => (
            <div key={c.key} className={styles.categoryChip}>
              <span className={styles.categoryLabel}>{c.label}</span>
              <span className={styles.categoryScore}>{c.score != null ? Math.round(c.score) : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {withExplanation.length > 0 && (
        <>
          <button
            type="button"
            className={styles.expandToggle}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            왜 이런 점수인가요?
            <ChevronDown size={16} className={expanded ? styles.chevronOpen : styles.chevron} />
          </button>

          {expanded && (
            <ul className={styles.explanationList}>
              {withExplanation.map((c) => (
                <li key={c.key}>
                  <b>{c.label}</b> — {c.explanation}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {regionalStrengths.length > 0 && (
        <div className={styles.regionalBlock}>
          <div className={styles.regionalTitle}>이 지역에서 눈에 띄는 강점</div>
          <ul className={styles.regionalList}>
            {regionalStrengths.map((s, i) => (
              <li key={i}>{s.label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
