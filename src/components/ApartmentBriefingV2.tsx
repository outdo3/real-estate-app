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
  if (transport.subwayScore >= 80) {
    strengths.push('지하철 접근성이 좋은 편');
  } else if (transport.busComponentScore >= 80) {
    strengths.push('버스 접근성이 좋은 편');
  }

  if (complex.scaleScore >= 85) {
    strengths.push('규모가 큰 대단지');
  } else if (complex.scaleScore >= 75) {
    strengths.push('무난한 규모의 단지');
  }

  if (complex.ageScore >= 85) {
    strengths.push('준공 연차가 짧은 신축 단지');
  } else if (complex.ageScore >= 65) {
    strengths.push('준신축 단지');
  }

  if (complex.parkingRawStatus === 'KNOWN' && complex.parkingScore >= 75) {
    strengths.push('주차 공간이 비교적 여유로운 편');
  }

  if (living.martScore >= 80 || living.hospitalScore >= 80 || living.convenienceScore >= 80) {
    strengths.push('상권 및 편의시설 접근 양호');
  }

  if (edu.elementaryScore >= 80) {
    strengths.push('초등학교 직선거리가 가까운 편');
  }

  // 2. 아쉬움 (Weaknesses)
  const weaknesses: string[] = [];
  if (transport.subwayStatus === 'CONFIRMED_ABSENT') {
    weaknesses.push('반경 내 지하철역이 없음');
  } else if (transport.subwayStatus === 'VALUE' && transport.subwayScore <= 40) {
    weaknesses.push('지하철역까지 직선거리가 다소 먼 편');
  }

  if (complex.scaleScore <= 50) {
    weaknesses.push('상대적으로 규모가 작은 단지');
  }

  if (complex.ageScore <= 40) {
    weaknesses.push('연식이 30년 이상 된 단지');
  }

  if (complex.parkingRawStatus === 'KNOWN' && complex.parkingScore <= 50) {
    weaknesses.push('세대당 주차 대수가 1대 미만임');
  }

  if (living.martScore <= 30 && living.convenienceScore <= 50) {
    weaknesses.push('주변 상권 및 편의시설이 상대적으로 적은 편');
  }

  // 3. 이런 분께 잘 맞아요 (Target Users)
  const targets: string[] = [];
  if (strengths.some(s => s.includes('지하철') || s.includes('버스'))) {
    targets.push('대중교통 접근을 중요하게 보는 분');
  }
  if (complex.ageScore >= 85) {
    targets.push('신축 단지를 선호하는 분');
  }
  if (complex.parkingRawStatus === 'KNOWN' && complex.parkingScore >= 75) {
    targets.push('차량 이용이 잦고 여유로운 주차가 필요한 분');
  }
  if (strengths.some(s => s.includes('상권'))) {
    targets.push('도보 거리 상권을 선호하는 분');
  }
  if (edu.elementaryScore >= 80) {
    targets.push('초등학교 통학 거리를 고려하는 분');
  }
  
  if (targets.length === 0) {
    targets.push('전반적으로 무난한 조건을 찾는 분');
  }

  // 4. 더 확인해볼 점 (Things to check)
  const checks: string[] = [];
  if (complex.parkingRawStatus === 'MISSING') {
    checks.push('실제 주차 여건 확인');
  }
  if (transport.subwayStatus === 'MISSING' || transport.subwayStatus === 'INVALID_OR_UNRESOLVED') {
    checks.push('대중교통 노선 확인');
  }
  if (edu.attendanceZoneStatus !== 'AVAILABLE') {
    checks.push('공식 통학구역(배정 학교) 확인');
  }
  checks.push('최근 실거래 가격 흐름 비교');

  const finalStrengths = strengths.slice(0, 3);
  const finalWeaknesses = weaknesses.slice(0, 2);
  const finalTargets = targets.slice(0, 3);

  // 5. 한줄 판단 (One-line judgment)
  let oneLiner = '';
  if (finalStrengths.length >= 2 && finalWeaknesses.length === 0) {
    oneLiner = '전반적으로 고른 강점을 갖춘 단지입니다.';
  } else if (finalStrengths.some(s => s.includes('교통') || s.includes('지하철')) && finalStrengths.some(s => s.includes('대단지'))) {
    oneLiner = '대중교통 접근이 좋고 대단지의 특징을 갖춘 단지입니다.';
  } else if (finalStrengths.some(s => s.includes('신축')) && finalWeaknesses.some(s => s.includes('교통') || s.includes('지하철'))) {
    oneLiner = '신축 단지이지만 대중교통 접근성은 확인이 필요합니다.';
  } else if (finalStrengths.some(s => s.includes('교통') || s.includes('지하철')) && finalWeaknesses.some(s => s.includes('연식'))) {
    oneLiner = '대중교통 접근이 좋지만 연식이 다소 있는 단지입니다.';
  } else if (finalWeaknesses.length >= 3) {
    oneLiner = '일부 아쉬운 점들이 있어 실제 방문 확인이 권장됩니다.';
  } else if (finalStrengths.length > 0) {
    oneLiner = `${finalStrengths[0].split(' ')[0]} 측면에서 강점이 있는 무난한 단지입니다.`;
  } else {
    oneLiner = '실거래와 주변 환경을 종합적으로 검토해볼 만한 단지입니다.';
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
