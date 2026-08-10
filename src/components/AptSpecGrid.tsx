import React from 'react';

interface AptSpecGridProps {
  address: string;
  aptInfo: Record<string, string> | null;
  buildYear: string | null; // trades[0].buildYear 등 실거래 기반 준공연도(문자열 "YYYY")
}

// 호갱노노 스타일: 큰 박스 4개 대신 "주소 | 세대수 | 준공연도(연차) | 용적률/건폐율 | 주차대수"를
// 한 줄 텍스트 + 소형 칩으로 압축해 공간을 아낀다. 값이 없으면 항상 "정보 없음"으로 표시하고
// 추정치를 만들어내지 않는다(예: 준공연월은 월 단위 원본 데이터가 없어 연도까지만 표기).
export default function AptSpecGrid({ address, aptInfo, buildYear }: AptSpecGridProps) {
  const currentYear = new Date().getFullYear();
  const parsedBuildYear = buildYear ? parseInt(buildYear, 10) : NaN;
  const age = !isNaN(parsedBuildYear) && parsedBuildYear > 1900 ? currentYear - parsedBuildYear : null;

  const households = aptInfo?.['세대수']
    ? (aptInfo['세대수'].includes('세대') ? aptInfo['세대수'] : `${aptInfo['세대수']}세대`)
    : null;
  const floorAreaRatio = aptInfo?.['용적률'] || null;
  const buildingCoverageRatio = aptInfo?.['건폐율'] || null;
  const parking = aptInfo?.['총주차대수'] || null;

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.2rem 0.6rem',
    borderRadius: '999px',
    background: '#f1f5f9',
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };

  const chips: string[] = [
    households ? `세대수 ${households}` : '세대수 정보 없음',
    parsedBuildYear ? `${parsedBuildYear}년 준공${age !== null ? ` · ${age}년차` : ''}` : '준공연도 정보 없음',
    (floorAreaRatio || buildingCoverageRatio)
      ? `용적률 ${floorAreaRatio || '정보 없음'} / 건폐율 ${buildingCoverageRatio || '정보 없음'}`
      : '용적률/건폐율 정보 없음',
    parking ? `주차 ${parking}` : '주차대수 정보 없음',
  ];

  return (
    <div style={{ marginTop: '0.75rem' }}>
      {address && (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          📍 {address}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {chips.map((chip) => (
          <span key={chip} style={chipStyle}>{chip}</span>
        ))}
      </div>
    </div>
  );
}
