'use client';

import React, { useState } from 'react';
import { getAreaInfo } from '@/lib/area-utils';

interface AreaSelectorProps {
  trades: Array<{ area: string }>;
  selectedArea: string;
  onSelect: (area: string) => void;
}

const MAX_CHIPS = 4;

// 거래량이 많은 상위 평형만 칩으로 노출하고, 나머지는 드롭다운(레이어)에서 선택한다.
// 현재 선택된 평형이 상위권 밖이어도 칩에 항상 보이도록 강제 포함한다.
export default function AreaSelector({ trades, selectedArea, onSelect }: AreaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const countByArea = new Map<string, number>();
  trades.forEach((t) => {
    countByArea.set(t.area, (countByArea.get(t.area) || 0) + 1);
  });

  const allAreas = Array.from(countByArea.keys()).sort((a, b) => parseFloat(a) - parseFloat(b));

  const topAreas = Array.from(countByArea.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CHIPS)
    .map(([area]) => area);

  const chipAreas = selectedArea !== '전체' && !topAreas.includes(selectedArea)
    ? [...topAreas, selectedArea]
    : topAreas;

  const renderAreaLabel = (area: string) => {
    const { supplyPyung } = getAreaInfo(parseFloat(area));
    return `${area} (공급 약 ${supplyPyung}평)`;
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.5rem 1rem',
    borderRadius: '999px',
    fontWeight: 600,
    border: '1px solid',
    cursor: 'pointer',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    backgroundColor: active ? 'var(--primary-color)' : 'white',
    color: active ? 'white' : 'var(--text-secondary)',
    borderColor: active ? 'var(--primary-color)' : 'var(--border-color)',
  });

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '0.25rem' }}>
        <button onClick={() => onSelect('전체')} style={chipStyle(selectedArea === '전체')}>
          전체
        </button>
        {chipAreas.map((area) => (
          <button key={area} onClick={() => onSelect(area)} style={chipStyle(selectedArea === area)}>
            {renderAreaLabel(area)}
          </button>
        ))}
        {allAreas.length > 0 && (
          <button
            onClick={() => setIsOpen(true)}
            style={{
              padding: '0.5rem 1rem', borderRadius: '999px', fontWeight: 600, border: '1px dashed var(--border-color)', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
              backgroundColor: 'white', color: 'var(--text-secondary)',
            }}
          >
            ▼ 전체 평형
          </button>
        )}
      </div>

      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', width: '90%', maxWidth: '360px', maxHeight: '70vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>전체 평형 선택</h3>
              <button onClick={() => setIsOpen(false)} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>&times;</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                onClick={() => { onSelect('전체'); setIsOpen(false); }}
                style={{
                  padding: '0.75rem 1rem', borderRadius: '8px', textAlign: 'left', border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600,
                  backgroundColor: selectedArea === '전체' ? 'var(--primary-color)' : 'white',
                  color: selectedArea === '전체' ? 'white' : 'var(--text-primary)',
                }}
              >
                전체
              </button>
              {allAreas.map((area) => (
                <button
                  key={area}
                  onClick={() => { onSelect(area); setIsOpen(false); }}
                  style={{
                    padding: '0.75rem 1rem', borderRadius: '8px', textAlign: 'left', border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600,
                    backgroundColor: selectedArea === area ? 'var(--primary-color)' : 'white',
                    color: selectedArea === area ? 'white' : 'var(--text-primary)',
                  }}
                >
                  {renderAreaLabel(area)} <span style={{ fontWeight: 400, opacity: 0.7 }}>({countByArea.get(area)}건)</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
