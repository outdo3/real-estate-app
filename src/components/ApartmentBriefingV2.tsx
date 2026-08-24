'use client';

import React from 'react';
import { CheckCircle2, MinusCircle, Info, HelpCircle } from 'lucide-react';
import styles from './ApartmentBriefingV2.module.css';

interface ApartmentBriefingV2Props {
  v2Result: any; 
}

export default function ApartmentBriefingV2({ v2Result }: ApartmentBriefingV2Props) {
  if (!v2Result) {
    return (
      <div className={styles.container}>
        <h3 className={styles.title}>단지 브리핑</h3>
        <p className={styles.emptyText}>데이터가 충분하지 않아 단지브리핑을 제공하기 어렵습니다.</p>
      </div>
    );
  }

  const dTransport = v2Result.domains.transport;
  const dLiving = v2Result.domains.living;
  const dEducation = v2Result.domains.education;
  const dComplex = v2Result.domains.complex;

  const transport = dTransport.evidence;
  const living = dLiving.evidence;
  const edu = dEducation.evidence;
  const complex = dComplex.evidence;

  // 1. 강점 (Strengths)
  const strengths: string[] = [];
  if (transport.subwayStatus === 'VALUE' && transport.nearestSubwayDistanceM != null && transport.nearestSubwayDistanceM <= 300) {
    strengths.push('지하철 접근성이 좋은 편');
  } else if (transport.busStopCount300m != null && transport.busStopCount300m >= 15) {
    strengths.push('버스 접근성이 좋은 편');
  }

  if (complex.totalHouseholds != null && complex.totalHouseholds >= 1000) {
    strengths.push('규모가 큰 대단지');
  } else if (complex.totalHouseholds != null && complex.totalHouseholds >= 500) {
    strengths.push('무난한 규모의 단지');
  }

  if (complex.ageYears != null && complex.ageYears <= 5) {
    strengths.push('준공 연차가 짧은 신축 단지');
  } else if (complex.ageYears != null && complex.ageYears <= 10) {
    strengths.push('준신축 단지');
  }

  if (living.martCount1000m != null && living.martCount1000m >= 1) {
    strengths.push('주변 상권 및 편의시설 양호');
  }

  if (edu.nearestElementaryDistanceM != null && edu.nearestElementaryDistanceM <= 300) {
    strengths.push('초등학교 직선거리가 가까운 편');
  }

  if (complex.parkingRawStatus === 'KNOWN' && complex.parkingRatio != null && complex.parkingRatio >= 1.2) {
    strengths.push('주차 공간이 비교적 여유로운 편');
  }

  // 2. 아쉬움 (Weaknesses)
  const weaknesses: string[] = [];
  if (transport.subwayStatus === 'CONFIRMED_ABSENT' || (transport.nearestSubwayDistanceM != null && transport.nearestSubwayDistanceM >= 1000)) {
    weaknesses.push('지하철 이용이 다소 불편할 수 있음');
  }
  
  if (complex.ageYears != null && complex.ageYears >= 30) {
    weaknesses.push('연식이 30년 이상 된 단지');
  }

  if (complex.parkingRawStatus === 'KNOWN' && complex.parkingRatio != null && complex.parkingRatio <= 0.8) {
    weaknesses.push('주차 공간이 다소 협소한 편');
  }

  // 3. 타겟 사용자 (Targets)
  const targets: string[] = [];
  if (transport.subwayStatus === 'VALUE' && transport.nearestSubwayDistanceM != null && transport.nearestSubwayDistanceM <= 300) {
    targets.push('대중교통 출퇴근을 하시는 분');
  }
  if (complex.totalHouseholds != null && complex.totalHouseholds >= 1000) {
    targets.push('대단지 인프라를 원하시는 분');
  }
  if (living.martCount1000m != null && living.martCount1000m >= 1) {
    targets.push('생활편의시설 접근을 중요하게 보는 분');
  }
  if (edu.nearestElementaryDistanceM != null && edu.nearestElementaryDistanceM <= 300) {
    targets.push('가까운 초등학교 접근을 중요하게 보는 분');
  }

  // 4. 추가 확인 필요 (Checks)
  const checks: string[] = [];
  if (complex.parkingRawStatus === 'MISSING') {
    checks.push('실제 주차 여건 확인');
  }
  if (edu.attendanceZoneStatus !== 'AVAILABLE') {
    checks.push('공식 통학구역(배정 학교) 확인');
  }

  // 5. 한줄 요약
  // Limit to 2 strengths, 1 weakness, 2 targets
  const finalStrengths = strengths.slice(0, 2);
  const finalWeaknesses = weaknesses.slice(0, 1);
  const finalTargets = targets.slice(0, 2);

  let oneLiner = '';
  if (finalStrengths.length >= 2 && finalWeaknesses.length === 0) {
    oneLiner = '전반적으로 고른 강점을 갖춘 단지입니다.';
  } else if (finalStrengths.some(s => s.includes('신축')) && finalWeaknesses.some(s => s.includes('교통') || s.includes('지하철'))) {
    oneLiner = '신축 단지이나 대중교통 접근성 확인이 필요합니다.';
  } else if (finalStrengths.some(s => s.includes('교통') || s.includes('지하철')) && finalWeaknesses.some(s => s.includes('연식'))) {
    oneLiner = '대중교통 접근성은 좋으나 연식이 다소 있는 단지입니다.';
  } else if (finalWeaknesses.length >= 3) {
    oneLiner = '몇 가지 아쉬운 점들이 있어 실제 방문 확인을 권장합니다.';
  } else if (finalStrengths.length > 0) {
    oneLiner = `${finalStrengths[0].split(' ')[0]} 측면에서 강점이 있는 무난한 단지입니다.`;
  } else {
    oneLiner = '주거지 및 주변 환경을 종합적으로 검토해볼 만한 단지입니다.';
  }

  if (v2Result.eligibility === 'NOT_ENOUGH_DATA') {
    oneLiner = '점수 산정 데이터가 충분하지 않아 단지브리핑도 확인 가능한 정보만 제한적으로 제공합니다.';
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>단지 브리핑</h3>
      
      <div className={styles.oneLinerCard}>
        <p className={styles.oneLinerText}>{oneLiner}</p>
      </div>

      <div className={styles.grid}>
        {finalStrengths.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <CheckCircle2 size={16} className={styles.iconGood} />
              <h4>강점</h4>
            </div>
            <ul className={styles.list}>
              {finalStrengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        {finalWeaknesses.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <MinusCircle size={16} className={styles.iconWeak} />
              <h4>아쉬움</h4>
            </div>
            <ul className={styles.list}>
              {finalWeaknesses.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className={styles.sectionFull}>
        <div className={styles.sectionHeaderInfo}>
          <Info size={16} className={styles.iconInfo} />
          <h4>이런 분께 잘 맞아요</h4>
        </div>
        <div className={styles.chipGroup}>
          {finalTargets.map((t, i) => (
            <span key={i} className={styles.chip}>{t}</span>
          ))}
        </div>
      </div>

      <div className={styles.sectionFull}>
        <div className={styles.sectionHeaderInfo}>
          <HelpCircle size={16} className={styles.iconHelp} />
          <h4>더 확인해볼 점</h4>
        </div>
        <ul className={styles.actionList}>
          {checks.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
