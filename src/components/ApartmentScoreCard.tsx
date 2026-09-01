'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './ApartmentScoreCard.module.css';
import type { ApartmentScoreApiResponse, ApartmentScorePeerContext } from '@/lib/apartment-score/client-types';
import { deriveScoreCardState, derivePeerVerdict } from './score-card-presenter';

interface ApartmentScoreCardProps {
  result: ApartmentScoreApiResponse | null;
  loading: boolean;
}

const SIZE_BAND_LABEL: Record<string, string> = {
  small: '50세대 미만',
  mid: '50~220세대',
  large: '221세대 이상',
  UNKNOWN: '규모 정보 없음',
};

// EJIP_SCORE_V2_PHASE2 — PHASE 1.6에서 검증한 confidence 정책 그대로: LOW(넓은
// fallback)는 정밀한 percentile 숫자를 크게 노출하지 않는다("낮은 confidence에서
// 잘못된 percentile을 보여줄 위험" 방지, §16). "꼴찌/최하위/나쁜 아파트" 같은
// resident-hostile 표현은 절대 쓰지 않는다(§17).
function renderPeerSection(peer: ApartmentScorePeerContext | null | undefined) {
  if (!peer || !peer.available) {
    return (
      <div className={styles.peerSection}>
        <div className={styles.peerTitle}>비슷한 단지와 비교</div>
        <p className={styles.peerUnavailableText}>비슷한 단지 비교 데이터가 충분하지 않습니다.</p>
      </div>
    );
  }

  const { peerCount, basis } = peer;
  const basisText = basis
    ? [basis.sigungu, basis.buildDecade ? `${basis.buildDecade.replace('s', '년대')} 준공` : null, basis.sizeBand ? SIZE_BAND_LABEL[basis.sizeBand] : null]
        .filter(Boolean)
        .join(' · ')
    : null;

  // 실제 노출 문구 결정은 score-card-presenter.ts의 derivePeerVerdict()로
  // 위임한다 — confidence별 percentile 노출 정책(§16)이 이 컴포넌트와
  // score-card-presenter.test.mjs 양쪽에서 갈라지지 않도록 하기 위함.
  const verdictResult = derivePeerVerdict(peer);
  let verdict: React.ReactNode;
  const dirClass = (d: 'up' | 'down' | 'neutral') => (d === 'up' ? styles.peerVerdictUp : d === 'down' ? styles.peerVerdictDown : '');
  if (verdictResult.kind === 'exact') {
    verdict = <span className={`${styles.peerVerdict} ${dirClass(verdictResult.direction)}`}>비슷한 단지 중 상위 {verdictResult.topPercent}% 수준</span>;
  } else if (verdictResult.kind === 'directional') {
    const wording = verdictResult.direction === 'up' ? '좋은 편' : verdictResult.direction === 'down' ? '비교군보다 낮은 편' : '비슷한 수준';
    verdict = <span className={`${styles.peerVerdict} ${dirClass(verdictResult.direction)}`}>비슷한 단지보다 {wording}</span>;
  } else if (verdictResult.kind === 'broad') {
    verdict = <span className={styles.peerVerdict}>넓은 비교군 기준 참고 수준입니다.</span>;
  }

  return (
    <div className={styles.peerSection}>
      <div className={styles.peerTitle}>비슷한 단지와 비교</div>
      {basisText && peerCount != null && (
        <div className={styles.peerBasis}>
          {basisText} · 비슷한 단지 {peerCount}곳과 비교
        </div>
      )}
      {verdict}
    </div>
  );
}

// dataConfidence(절대점수 자체의 신뢰도, V2 eligibility)와 peerConfidence(비교
// 신뢰도)는 서로 다른 개념이다(§21) — 하나로 뭉뚱그리지 않고 각자 정직하게 표시한다.
function renderDataStatusRow(eligibility: string, peer: ApartmentScorePeerContext | null | undefined) {
  const dataStatusLabel = eligibility === 'SCORE_AVAILABLE' ? '분석 가능' : '일부 데이터 부족';
  const peerStatusLabel = peer && peer.available ? '분석 가능' : '비교 데이터 부족';
  return (
    <div className={styles.dataStatusRow}>
      <span className={styles.dataStatusItem}>
        <span className={styles.dataStatusLabel}>절대 평가</span> {dataStatusLabel}
      </span>
      <span className={styles.dataStatusItem}>
        <span className={styles.dataStatusLabel}>비교 평가</span> {peerStatusLabel}
      </span>
    </div>
  );
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

  // EJIP_SCORE_V2_PHASE2 — 화면에 실제로 쓰이는 건 V2이므로, 표시 여부도 V2 자신의
  // eligibility로 판단한다. V1의 status/coverage는 더 이상 게이트로 쓰지 않는다
  // (PHASE 1.5/1.6에서 발견한 V1 coverage가 V2 display를 가리는 구조적 결함 수정 —
  // V1 formula/coverage 계산 자체는 변경하지 않음, 이 컴포넌트의 판단 기준만 수정).
  // 실제 분기 판단은 score-card-presenter.ts의 deriveScoreCardState()로 위임한다
  // (score-card-presenter.test.mjs로 V1/V2 게이트 독립성을 직접 검증).
  const cardState = deriveScoreCardState(result);

  if (!result || cardState.kind === 'no-result') {
    return (
      <div className={styles.cardCompact}>
        <span className={styles.titleSmall}>이집점수</span>
        <span className={styles.unavailableText}>점수 산정 준비 중입니다.</span>
      </div>
    );
  }

  if (cardState.kind === 'not-enough-data') {
    return (
      <div className={styles.cardCompact}>
        <span className={styles.titleSmall}>이집점수</span>
        <span className={styles.unavailableText}>점수 산정에 필요한 데이터가 부족합니다.</span>
      </div>
    );
  }

  // V2 UI
  if (cardState.kind === 'ok') {
    const v2 = cardState.v2;
    // SCORE_AVAILABLE or LIMITED
    const dTransport = v2.domains.transport;
    const dLiving = v2.domains.living;
    const dEducation = v2.domains.education;
    const dComplex = v2.domains.complex;

    // Helper to format distances
    const formatDist = (m: number | null | undefined) => (m != null ? `${m}m` : '정보없음');

    // Transport summary
    const transportSummary = [];
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
    const complexSummary = [];
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

        {renderPeerSection(result.peerContext)}

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
              * 점수는 교통·생활·교육·단지를 동일 비중(각 25%)으로 산출한 절대 평가입니다(다른 단지와 비교해 매긴 순위가 아닙니다).
            </p>
          </div>
        )}

        {renderDataStatusRow(v2.eligibility, result.peerContext)}
      </div>
    );
  }

  // cardState.kind === 'v2-absent' -> Safe Unavailable State
  return (
    <div className={styles.cardCompact}>
      <span className={styles.titleSmall}>이집점수</span>
      <span className={styles.unavailableText}>이집점수를 현재 확인할 수 없습니다.</span>
    </div>
  );
}
