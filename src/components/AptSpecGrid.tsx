import React from 'react';

interface AptSpecGridProps {
  aptInfo: Record<string, string> | null;
  buildYear: string | null; // trades[0].buildYear 등 실거래 기반 준공연도(문자열 "YYYY")
}

// 단지 기본 스펙(연차/세대수/용적률/주차대수)을 1구역 상단에 한눈에 보여주는 4칸 그리드.
// 값이 없으면 항상 "정보 없음"으로 표시하고 추정치를 만들어내지 않는다.
export default function AptSpecGrid({ aptInfo, buildYear }: AptSpecGridProps) {
  const currentYear = new Date().getFullYear();
  const parsedBuildYear = buildYear ? parseInt(buildYear, 10) : NaN;
  const age = !isNaN(parsedBuildYear) && parsedBuildYear > 1900 ? currentYear - parsedBuildYear : null;

  const households = aptInfo?.['세대수']
    ? (aptInfo['세대수'].includes('세대') ? aptInfo['세대수'] : `${aptInfo['세대수']}세대`)
    : null;
  const floorAreaRatio = aptInfo?.['용적률'] || null;
  const parking = aptInfo?.['총주차대수'] || null;

  const items: { label: string; value: string }[] = [
    { label: '연차', value: age !== null ? `${age}년차` : '정보 없음' },
    { label: '세대수', value: households || '정보 없음' },
    { label: '용적률', value: floorAreaRatio || '정보 없음' },
    { label: '주차대수', value: parking || '정보 없음' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '10px',
            background: '#f8fafc',
            border: '1px solid var(--border-color)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>{item.label}</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}
