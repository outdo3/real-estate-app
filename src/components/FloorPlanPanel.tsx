import React from 'react';
import { getAreaInfo } from '@/lib/area-utils';

interface FloorPlanPanelProps {
  selectedArea: string; // '전체' 또는 전용면적(m²) 문자열
}

// 평면도 이미지를 제공하는 실제 데이터 소스가 아직 없다 — 단지별 평면도는 건설사/분양 공고문
// 이미지가 필요한데 이 앱에는 그런 자산이나 API가 연동돼 있지 않다. 없는 이미지를 만들어
// 보여주는 대신, 선택된 평형 기준으로 "준비 중" 상태를 정직하게 보여주는 자리만 마련해둔다.
export default function FloorPlanPanel({ selectedArea }: FloorPlanPanelProps) {
  const areaLabel = selectedArea !== '전체' ? getAreaInfo(parseFloat(selectedArea)).label : null;

  return (
    <div
      style={{
        marginTop: '1.5rem',
        padding: '2rem 1.5rem',
        borderRadius: '12px',
        border: '1px dashed var(--border-color)',
        background: '#f8fafc',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📐</div>
      <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
        {areaLabel ? `${areaLabel} 평면도` : '평면도'}
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        평면도 이미지는 준비 중입니다. 평형 칩에서 확인하고 싶은 타입을 선택해 두시면 제공되는 대로 표시됩니다.
      </div>
    </div>
  );
}
