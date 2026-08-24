'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './ApartmentScoreCard.module.css';
import type { ApartmentScoreApiResponse } from '@/lib/apartment-score/client-types';

interface ApartmentScoreCardProps {
  result: ApartmentScoreApiResponse | null;
  loading: boolean;
}

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

  if (!result || result.status !== 'OK' || result.score == null) {
    return (
      <div className={styles.cardCompact}>
        <span className={styles.titleSmall}>이집점수</span>
        <span className={styles.unavailableText}>점수 산정 준비 중입니다.</span>
      </div>
    );
  }

  // V2 UI
  const v2 = result._shadowV2;
  if (v2) {
    if (v2.eligibility === 'NOT_ENOUGH_DATA') {
      return (
        <div className={styles.cardCompact}>
          <span className={styles.titleSmall}>이집점수</span>
          <span className={styles.unavailableText}>점수 산정에 필요한 데이터가 부족합니다.</span>
        </div>
      );
    }

    // SCORE_AVAILABLE or LIMITED
    const dTransport = v2.domains.transport;
    const dLiving = v2.domains.living;
    const dEducation = v2.domains.education;
    const dComplex = v2.domains.complex;

    // Helper to format distances
    const formatDist = (m: number | null | undefined) => (m != null ? `${m}m` : '정보없음');

    // Transport summary
    let transportSummary = [];
    if (dTransport.evidence.subwayStatus === 'VALUE' || dTransport.evidence.subwayStatus === 'CONFIRMED_ABSENT') {
      transportSummary.push(
        dTransport.evidence.subwayStatus === 'CONFIRMED_ABSENT'
          ? '지하철역 부재'
          : `지하철 ${formatDist(dTransport.evidence.nearestSubwayDistanceM as number)}`
      );
    } else {
      transportSummary.push('지하철 정보없음');
    }
    if (dTransport.evidence.nearestBusStopDistanceM != null) {
      transportSummary.push(`버스정류장 ${dTransport.evidence.nearestBusStopDistanceM}m`);
    }
    const transportText = transportSummary.join(' · ');

    // Living summary
    const livingText = `편의점 ${dLiving.evidence.convenienceCount500m}개 · 약국 ${dLiving.evidence.pharmacyCount500m}개`;

    // Education summary
    const eduText = `가까운 초등학교 직선거리 약 ${formatDist(dEducation.evidence.nearestElementaryDistanceM as number)}`;

    // Complex summary
    let complexSummary = [];
    if (dComplex.evidence.buildYear) complexSummary.push(`${dComplex.evidence.buildYear}년 준공`);
    if (dComplex.evidence.totalHouseholds) complexSummary.push(`${dComplex.evidence.totalHouseholds}세대`);
    const complexText = complexSummary.join(' · ');

    // Attendance Zone Wording mapping
    const getAttendanceWording = (status: string | null | undefined) => {
      switch (status) {
        case 'AVAILABLE':
          return '(공식 통학구역 정보가 반영되었습니다.)';
        case 'SHARED':
          return '(공식 통학구역은 공동학구입니다.)';
        case 'REVIEW_REQUIRED':
          return '(공식 통학구역 배정에 추가 확인이 필요합니다.)';
        case 'NOT_AVAILABLE':
        default:
          return '(공식 통학구역 정보 확인이 필요합니다.)';
      }
    };

    return (
      <div className={styles.card}>
        <div className={styles.headerRow}>
          <span className={styles.title}>이집점수</span>
          <span className={styles.betaBadge}>Beta</span>
        </div>

        <div className={styles.scoreRow}>
          <span className={styles.scoreNumber}>{v2.overallScore != null ? Math.round(v2.overallScore) : '-'}</span>
          <span className={styles.scoreScale}>/100</span>
          {v2.eligibility === 'LIMITED' && (
            <span className={styles.scoreSubtitle} style={{ color: '#eab308', marginLeft: '8px' }}>제한된 데이터</span>
          )}
        </div>

        <p className={styles.caption}>교통·생활·교육·단지 데이터를 기준으로 평가한 이집의 주거 품질 점수입니다.</p>

        <div className={styles.v2DomainsRow}>
          <div className={styles.v2DomainItem}>
            <div className={styles.v2DomainHeader}>
              <span className={styles.v2DomainName}>교통</span>
              <span className={styles.v2DomainScore}>{dTransport.score != null ? Math.round(dTransport.score) : '-'}점</span>
            </div>
            <div className={styles.v2DomainEvidence}>{transportText}</div>
          </div>
          <div className={styles.v2DomainItem}>
            <div className={styles.v2DomainHeader}>
              <span className={styles.v2DomainName}>생활</span>
              <span className={styles.v2DomainScore}>{dLiving.score != null ? Math.round(dLiving.score) : '-'}점</span>
            </div>
            <div className={styles.v2DomainEvidence}>{livingText}</div>
          </div>
          <div className={styles.v2DomainItem}>
            <div className={styles.v2DomainHeader}>
              <span className={styles.v2DomainName}>교육</span>
              <span className={styles.v2DomainScore}>{dEducation.score != null ? Math.round(dEducation.score) : '-'}점</span>
            </div>
            <div className={styles.v2DomainEvidence}>{eduText}</div>
          </div>
          <div className={styles.v2DomainItem}>
            <div className={styles.v2DomainHeader}>
              <span className={styles.v2DomainName}>단지</span>
              <span className={styles.v2DomainScore}>{dComplex.score != null ? Math.round(dComplex.score) : '-'}점</span>
            </div>
            <div className={styles.v2DomainEvidence}>{complexText}</div>
          </div>
        </div>

        <button
          type="button"
          className={styles.expandToggle}
          style={{ marginTop: '1rem' }}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          왜 이런 점수인가요?
          <ChevronDown size={16} className={expanded ? styles.chevronOpen : styles.chevron} />
        </button>

        {expanded && (
          <div className={styles.v2ExplanationSection}>
            <div className={styles.v2ExplanationGroup}>
              <div className={styles.v2ExplanationGroupTitle}>[교통]</div>
              <ul className={styles.v2ExplanationList}>
                {dTransport.evidence.subwayStatus === 'CONFIRMED_ABSENT' ? (
                  <li>반경 내 지하철역이 없습니다. (최소 점수 적용)</li>
                ) : dTransport.evidence.nearestSubwayDistanceM != null ? (
                  <li>지하철역까지 직선거리 {dTransport.evidence.nearestSubwayDistanceM}m</li>
                ) : (
                  <li>지하철역 정보를 확인할 수 없습니다.</li>
                )}
                {dTransport.evidence.nearestBusStopDistanceM != null ? (
                  <li>버스정류장까지 직선거리 {dTransport.evidence.nearestBusStopDistanceM}m (반경 300m 내 {dTransport.evidence.busStopCount300m}개)</li>
                ) : (
                  <li>버스정류장 정보를 확인할 수 없습니다.</li>
                )}
              </ul>
            </div>
            <div className={styles.v2ExplanationGroup}>
              <div className={styles.v2ExplanationGroupTitle}>[생활]</div>
              <ul className={styles.v2ExplanationList}>
                <li>반경 500m 내 편의점 {dLiving.evidence.convenienceCount500m}개, 약국 {dLiving.evidence.pharmacyCount500m}개</li>
                <li>반경 1km 내 마트 {dLiving.evidence.martCount1000m}개, 병원 {dLiving.evidence.hospitalCount1000m}개, 공원 {dLiving.evidence.parkCount1000m}개</li>
              </ul>
            </div>
            <div className={styles.v2ExplanationGroup}>
              <div className={styles.v2ExplanationGroupTitle}>[교육]</div>
              <ul className={styles.v2ExplanationList}>
                <li>가까운 초등학교 직선거리 {formatDist(dEducation.evidence.nearestElementaryDistanceM as number)}</li>
                <li>{getAttendanceWording(dEducation.evidence.attendanceZoneStatus as string | null | undefined)}</li>
              </ul>
            </div>
            <div className={styles.v2ExplanationGroup}>
              <div className={styles.v2ExplanationGroupTitle}>[단지]</div>
              <ul className={styles.v2ExplanationList}>
                <li>{dComplex.evidence.buildYear}년 준공 ({dComplex.evidence.ageYears}년차), 총 {dComplex.evidence.totalHouseholds}세대</li>
                {dComplex.evidence.parkingRawStatus === 'KNOWN' ? (
                  <li>세대당 주차 {typeof dComplex.evidence.parkingRatio === 'number' ? dComplex.evidence.parkingRatio.toFixed(2) : '-'}대</li>
                ) : (
                  <li>주차 정보가 없어 해당 항목은 데이터 결측 처리 기준을 적용했습니다.</li>
                )}
              </ul>
            </div>
            <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              * 점수는 교통·생활·교육·단지를 동일 비중(각 25%)으로 반영하여 산출합니다.
            </p>
          </div>
        )}
      </div>
    );
  }

  // V2 absent or failed -> Safe Unavailable State
  return (
    <div className={styles.cardCompact}>
      <span className={styles.titleSmall}>이집점수</span>
      <span className={styles.unavailableText}>이집점수를 현재 확인할 수 없습니다.</span>
    </div>
  );
}
