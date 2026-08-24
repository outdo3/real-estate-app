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
  if (transport.subwayStatus === 'VALUE' && typeof transport.nearestSubwayDistanceM === 'number' && transport.nearestSubwayDistanceM <= 500) {
    strengths.push('지하철역이 가까워 교통이 편리한 편');
  } else if (typeof transport.nearestBusStopDistanceM === 'number' && transport.nearestBusStopDistanceM <= 200 && typeof transport.busStopCount300m === 'number' && transport.busStopCount300m >= 10) {
    strengths.push('버스 등 대중교통 이용이 수월함');
  }

  if (typeof complex.totalHouseholds === 'number' && complex.totalHouseholds >= 1000) {
    strengths.push('상가 등 인프라와 관리가 유리한 대단지');
  } else if (typeof complex.totalHouseholds === 'number' && complex.totalHouseholds >= 500) {
    strengths.push('무난한 규모의 중형 단지');
  }

  if (typeof complex.ageYears === 'number' && complex.ageYears <= 5) {
    strengths.push('쾌적한 주거환경을 갖춘 신축');
  } else if (typeof complex.ageYears === 'number' && complex.ageYears <= 15) {
    strengths.push('관리 상태가 양호한 준신축');
  }

  if (complex.parkingRawStatus === 'KNOWN' && typeof complex.parkingRatio === 'number' && complex.parkingRatio >= 1.2) {
    strengths.push('주차 공간이 비교적 여유로운 편');
  }

  if (typeof living.martCount1000m === 'number' && living.martCount1000m >= 2 || typeof living.hospitalCount1000m === 'number' && living.hospitalCount1000m >= 10 || typeof living.convenienceCount500m === 'number' && living.convenienceCount500m >= 15) {
    strengths.push('주변 상권 및 생활 편의시설 풍부');
  }

  if (typeof edu.nearestElementaryDistanceM === 'number' && edu.nearestElementaryDistanceM <= 300) {
    strengths.push('초등학교 접근성이 좋은 편');
  }

  // 2. 아쉬움 (Weaknesses)
  const weaknesses: string[] = [];
  if (transport.subwayStatus === 'CONFIRMED_ABSENT') {
    weaknesses.push('지하철역이 멀어 대중교통 이용이 다소 아쉬움');
  } else if (transport.subwayStatus === 'VALUE' && typeof transport.nearestSubwayDistanceM === 'number' && transport.nearestSubwayDistanceM > 1000) {
    weaknesses.push('지하철역까지 거리가 다소 먼 편');
  }

  if (typeof complex.totalHouseholds === 'number' && complex.totalHouseholds < 200) {
    weaknesses.push('상대적으로 관리비 부담이 있을 수 있는 소규모');
  }

  if (typeof complex.ageYears === 'number' && complex.ageYears > 30) {
    weaknesses.push('연식이 30년 이상 되어 노후도가 있는 편');
  }

  if (complex.parkingRawStatus === 'KNOWN' && typeof complex.parkingRatio === 'number' && complex.parkingRatio < 1.0) {
    weaknesses.push('세대당 주차 대수가 1대 미만으로 혼잡할 수 있음');
  }

  if (typeof living.martCount1000m === 'number' && living.martCount1000m === 0 && typeof living.convenienceCount500m === 'number' && living.convenienceCount500m <= 2) {
    weaknesses.push('주변 대형 편의시설이 상대적으로 부족한 편');
  }

  // 3. 이런 분께 잘 맞아요 (Target Users)
  const targets: string[] = [];
  if (strengths.some(s => s.includes('지하철') || s.includes('대중교통'))) {
    targets.push('대중교통 출퇴근이 잦은 분');
  }
  if (typeof complex.ageYears === 'number' && complex.ageYears <= 10) {
    targets.push('신축급의 깨끗한 주거환경을 선호하는 분');
  }
  if (complex.parkingRawStatus === 'KNOWN' && typeof complex.parkingRatio === 'number' && complex.parkingRatio >= 1.2) {
    targets.push('차량 이용이 많아 넉넉한 주차가 중요한 분');
  }
  if (strengths.some(s => s.includes('편의시설'))) {
    targets.push('도보 거리에 다양한 상권이 필요한 분');
  }
  if (typeof edu.nearestElementaryDistanceM === 'number' && edu.nearestElementaryDistanceM <= 300) {
    targets.push('가까운 초등학교 등교 거리를 고려하는 분');
  }
  
  if (targets.length === 0) {
    targets.push('전반적으로 무난한 주거 조건을 찾는 분');
  }

  // 4. 더 확인해볼 점 (Things to check)
  const checks: string[] = [];
  if (complex.parkingRawStatus === 'MISSING') {
    checks.push('단지 내 실제 주차 여건 확인');
  }
  if (transport.subwayStatus === 'MISSING' || transport.subwayStatus === 'INVALID_OR_UNRESOLVED') {
    checks.push('대중교통 노선 및 출퇴근 시간대 소요 시간 확인');
  }
  if (edu.attendanceZoneStatus !== 'AVAILABLE') {
    checks.push('공식 배정 초등학교 확인');
  }
  checks.push('최근 실거래 가격 흐름 비교');

  const finalStrengths = strengths.slice(0, 3);
  const finalWeaknesses = weaknesses.slice(0, 2);
  const finalTargets = targets.slice(0, 3);

  // 5. 한줄 판단 (One-line judgment)
  let oneLiner = '';
  if (finalStrengths.length >= 2 && finalWeaknesses.length === 0) {
    oneLiner = '전반적인 주거 여건이 우수하며 고른 장점을 갖춘 단지입니다.';
  } else if (finalStrengths.some(s => s.includes('교통')) && finalStrengths.some(s => s.includes('대단지'))) {
    oneLiner = '우수한 대중교통 접근성과 대단지의 장점을 모두 갖춘 단지입니다.';
  } else if (finalStrengths.some(s => s.includes('신축')) && finalWeaknesses.some(s => s.includes('교통'))) {
    oneLiner = '쾌적한 신축 단지이지만 대중교통 접근성은 확인이 필요합니다.';
  } else if (finalStrengths.some(s => s.includes('교통')) && finalWeaknesses.some(s => s.includes('노후도'))) {
    oneLiner = '뛰어난 대중교통 접근성을 갖추었으나 연식이 다소 있는 단지입니다.';
  } else if (finalWeaknesses.length >= 3) {
    oneLiner = '일부 아쉬운 점들이 있어 실제 방문을 통한 꼼꼼한 확인이 권장됩니다.';
  } else if (finalStrengths.length > 0) {
    oneLiner = `${finalStrengths[0].split(' ')[0]} 측면에서 장점이 돋보이는 무난한 단지입니다.`;
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
