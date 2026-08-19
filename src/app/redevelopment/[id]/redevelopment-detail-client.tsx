'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import Header from '@/components/Header';
import {
  BUSINESS_TYPE_LABELS,
  STAGE_LABELS,
  stageGroup,
  sourceLabel,
  sidoShortLabel,
  formatDataUpdatedAt,
  projectStatusLabel,
} from '@/lib/redevelopment/labels';
import styles from './detail.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type SourceSummary = {
  source: string;
  rawName: string;
  rawBusinessType: string | null;
  rawStage: string | null;
  rawHouseholdCount: string | null;
  sourceUpdatedAt: string | null;
  collectedAt: string;
};

type RedevelopmentDetail = {
  id: number;
  canonicalName: string;
  sido: string;
  sigungu: string;
  businessType: string;
  stage: string;
  status: string;
  householdCount: number | null;
  hasSafeMapLocation: boolean;
  primarySource: string;
  dataUpdatedAt: string;
  dataQuality: 'OK' | 'REVIEW_REQUIRED';
  sources: SourceSummary[];
  fieldProvenance: { businessType: string; stage: string; householdCount: string };
};

function stageBadgeClass(stage: string): string {
  const group = stageGroup(stage as any);
  if (group === 'done') return styles.badgeDone;
  if (group === 'stopped') return styles.badgeStopped;
  if (group === 'unknown') return styles.badgeUnknown;
  return styles.badgeActive;
}

function formatRawHouseholdCount(v: string | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed === '해당없음') return null;
  const n = parseInt(trimmed.replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString()}세대` : null;
}

export default function RedevelopmentDetailClient() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const { data, isLoading } = useSWR(id ? `/api/redevelopment/${id}` : null, fetcher);

  const detail: RedevelopmentDetail | null = data?.success ? data.data : null;
  const fetchError = data && !data.success ? data.error : null;

  return (
    <div className={styles.main}>
      <Header pageTitle="재개발 상세" />
      <div className="container">
        <button type="button" className={styles.backLink} onClick={() => router.push('/redevelopment')}>
          ← 재개발·재건축 목록
        </button>

        {isLoading ? (
          <div className={styles.stateBox}>정보를 불러오는 중입니다...</div>
        ) : fetchError ? (
          <div className={styles.stateBox}>
            <img src="/brand/mascot/ejipy-error.webp" alt="" className={styles.stateMascot} />
            <div>{fetchError}</div>
          </div>
        ) : !detail ? (
          <div className={styles.stateBox}>
            <img src="/brand/mascot/ejipy-error.webp" alt="" className={styles.stateMascot} />
            <div>해당 재개발 사업을 찾을 수 없습니다.</div>
          </div>
        ) : (
          <>
            <div className={styles.heroCard}>
              <div className={styles.heroTitleRow}>
                <h1 className={styles.heroTitle}>{detail.canonicalName}</h1>
              </div>
              <div className={styles.badgeRow}>
                <span className={`${styles.badge} ${styles.badgeType}`}>
                  {BUSINESS_TYPE_LABELS[detail.businessType as keyof typeof BUSINESS_TYPE_LABELS] ?? detail.businessType}
                </span>
                <span className={`${styles.badge} ${stageBadgeClass(detail.stage)}`}>
                  {STAGE_LABELS[detail.stage as keyof typeof STAGE_LABELS] ?? detail.stage}
                </span>
              </div>
              <div className={styles.heroRegion}>
                {sidoShortLabel(detail.sido)} {detail.sigungu} · {projectStatusLabel(detail.status)}
              </div>

              {detail.dataQuality === 'REVIEW_REQUIRED' && (
                <div className={styles.reviewNote}>일부 정보 확인 중입니다. 확정되는 대로 갱신됩니다.</div>
              )}
            </div>

            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <div className={styles.infoLabel}>세대수</div>
                <div className={styles.infoValue}>
                  {detail.householdCount != null ? `${detail.householdCount.toLocaleString()}세대` : '세대수 정보 없음'}
                </div>
                <div className={styles.infoProvenance}>{detail.fieldProvenance.householdCount}</div>
              </div>
              <div className={styles.infoItem}>
                <div className={styles.infoLabel}>진행단계</div>
                <div className={styles.infoValue}>{STAGE_LABELS[detail.stage as keyof typeof STAGE_LABELS] ?? detail.stage}</div>
                <div className={styles.infoProvenance}>{detail.fieldProvenance.stage}</div>
              </div>
              <div className={styles.infoItem}>
                <div className={styles.infoLabel}>사업유형</div>
                <div className={styles.infoValue}>
                  {BUSINESS_TYPE_LABELS[detail.businessType as keyof typeof BUSINESS_TYPE_LABELS] ?? detail.businessType}
                </div>
                <div className={styles.infoProvenance}>{detail.fieldProvenance.businessType}</div>
              </div>
            </div>

            <div className={styles.mapBox}>
              {detail.hasSafeMapLocation ? (
                <div className={styles.mapPlaceholder}>지도 표시 준비 중입니다.</div>
              ) : (
                <div className={styles.mapNote}>
                  정확한 사업 위치가 아직 확인되지 않았습니다. 위치 정보가 확인되면 지도에 표시됩니다.
                </div>
              )}
            </div>

            <div className={styles.sourceSection}>
              <h2 className={styles.sourceTitle}>데이터 출처</h2>
              {detail.sources.map((s) => (
                <div key={s.source} className={styles.sourceCard}>
                  <div className={styles.sourceName}>{sourceLabel(s.source)}</div>
                  <div className={styles.sourceDetailRow}>
                    <span>원본 사업명</span>
                    <span>{s.rawName}</span>
                  </div>
                  {s.rawStage && (
                    <div className={styles.sourceDetailRow}>
                      <span>원본 진행단계</span>
                      <span>{s.rawStage}</span>
                    </div>
                  )}
                  {formatRawHouseholdCount(s.rawHouseholdCount) && (
                    <div className={styles.sourceDetailRow}>
                      <span>원본 세대수</span>
                      <span>{formatRawHouseholdCount(s.rawHouseholdCount)}</span>
                    </div>
                  )}
                  {formatDataUpdatedAt(s.collectedAt) && (
                    <div className={styles.sourceDetailRow}>
                      <span>수집 시점</span>
                      <span>{formatDataUpdatedAt(s.collectedAt)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {formatDataUpdatedAt(detail.dataUpdatedAt) && (
              <p className={styles.freshness}>데이터 갱신 {formatDataUpdatedAt(detail.dataUpdatedAt)}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
