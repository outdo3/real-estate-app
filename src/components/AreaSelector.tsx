'use client';

import React, { useState } from 'react';
import { resolveAreaLabel } from '@/lib/area-utils';

interface AreaSelectorProps {
  trades: Array<{ area: string }>;
  selectedArea: string;
  onSelect: (area: string) => void;
  // 부모(apt-client.tsx)가 이 단지의 전체 거래 기준으로 미리 만든 충돌 해소 라벨
  // 맵. Hero/거래목록과 동일한 라벨을 쓰기 위해 여기서 새로 계산하지 않고 그대로
  // 조회만 한다.
  areaLabels?: Map<number, string>;
}

// [APT DETAIL QA/IA v1] 이전에는 거래량 상위 4개만 칩 상한을 둬서 노출하고 나머지는
// "▼ 전체 평형" 모달에서만 선택 가능했다 — 실측(서구/해운대 활성 단지 20곳) 결과
// 85%가 실제 평형 종류 5개 이상이었고, 일부는 최대 39종까지 있어 기본 화면에서
// 절반 이상의 실존 평형이 안 보이는 문제로 이어졌다(데이터 손실이 아니라 상한값
// 자체가 원인). 상한을 없애고 전체를 가로 스크롤 칩으로 노출한다 — 컨테이너는
// 이미 overflowX:'auto'라 칩이 많아도 스크롤만 될 뿐 깨지지 않는다. 모달은 평형이
// 많은 단지에서 빠르게 점프하는 보조 수단으로만 남긴다.
export default function AreaSelector({ trades, selectedArea, onSelect, areaLabels }: AreaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const countByArea = new Map<string, number>();
  trades.forEach((t) => {
    countByArea.set(t.area, (countByArea.get(t.area) || 0) + 1);
  });

  const allAreas = Array.from(countByArea.keys()).sort((a, b) => parseFloat(a) - parseFloat(b));

  const chipAreas = allAreas;

  const renderAreaLabel = (area: string) => resolveAreaLabel(parseFloat(area), areaLabels);

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
