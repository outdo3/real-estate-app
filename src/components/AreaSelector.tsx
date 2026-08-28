'use client';

import React, { useState } from 'react';
import { resolveAreaLabel, resolveAreaChipDisplay, type DisplayUnit } from '@/lib/area-utils';
import Chip from '@/components/ui/Chip';
import AreaChip, { AreaChipData } from '@/components/ui/AreaChip';

interface AreaSelectorProps {
  trades: Array<{ area: string }>;
  selectedArea: string;
  onSelect: (area: string) => void;
  // 부모(apt-client.tsx)가 이 단지의 전체 거래 기준으로 미리 만든 충돌 해소 라벨
  // 맵. Hero/거래목록과 동일한 라벨을 쓰기 위해 여기서 새로 계산하지 않고 그대로
  // 조회만 한다.
  areaLabels?: Map<number, string>;
  unitMaster?: DisplayUnit[] | null;
  areaUnit?: '㎡' | '평';
}

// [APT DETAIL QA/IA v1] 이전에는 거래량 상위 4개만 칩 상한을 둬서 노출하고 나머지는
// "▼ 전체 평형" 모달에서만 선택 가능했다 — 실측(서구/해운대 활성 단지 20곳) 결과
// 85%가 실제 평형 종류 5개 이상이었고, 일부는 최대 39종까지 있어 기본 화면에서
// 절반 이상의 실존 평형이 안 보이는 문제로 이어졌다(데이터 손실이 아니라 상한값
// 자체가 원인). 상한을 없애고 전체를 가로 스크롤 칩으로 노출한다 — 컨테이너는
// 이미 overflowX:'auto'라 칩이 많아도 스크롤만 될 뿐 깨지지 않는다. 모달은 평형이
// 많은 단지에서 빠르게 점프하는 보조 수단으로만 남긴다.
export default function AreaSelector({ trades, selectedArea, onSelect, areaLabels, unitMaster, areaUnit = '㎡' }: AreaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const countByArea = new Map<string, number>();
  trades.forEach((t) => {
    countByArea.set(t.area, (countByArea.get(t.area) || 0) + 1);
  });

  // If unitMaster is available, use it. Otherwise, fallback to trades.
  const hasUnitMaster = Array.isArray(unitMaster) && unitMaster.length > 0;
  
  const allAreas = hasUnitMaster 
    ? unitMaster.map(u => u.canonicalExclusiveArea)
    : Array.from(countByArea.keys()).sort((a, b) => parseFloat(a) - parseFloat(b));

  const chipAreas = allAreas;

  const renderAreaLabel = (area: string) => resolveAreaLabel(parseFloat(area), areaLabels);

  // Check collisions
  const pyeongCount = new Map<number, number>();
  if (hasUnitMaster) {
    unitMaster.forEach(u => {
      if (u.representativePyeong) {
        pyeongCount.set(u.representativePyeong, (pyeongCount.get(u.representativePyeong) || 0) + 1);
      }
    });
  }

  // APT DETAIL CONSISTENCY HOTFIX V1 §7~§9 — toggle는 항상 노출되므로(부모가 더 이상
  // 숨기지 않음) resolveAreaChipDisplay(area-utils.ts, 단위 테스트됨)가 모든 area에
  // 대해 평 모드에서 "정직한 결과"를 내도록 위임한다 — 절대 exclusiveArea/3.3058
  // 같은 계산을 여기서 하지 않는다(§4 데이터 신뢰 원칙 그대로).
  const toAreaChipData = (area: string): AreaChipData => {
    const parsedArea = parseFloat(area);
    const unit = hasUnitMaster ? unitMaster.find(u => u.canonicalExclusiveArea === area) ?? null : null;
    // [AREA MODEL V2] representativePyeong collision resolution: if multiple units
    // share the same pyeong, we show the exclusive area to distinguish them.
    const isCollision = unit?.representativePyeong ? (pyeongCount.get(unit.representativePyeong) || 0) > 1 : false;

    const { displayLabel, pyeongLabel } = resolveAreaChipDisplay(unit, areaUnit, isCollision, renderAreaLabel(area));

    return {
      id: area,
      exclusiveAreaM2: parsedArea,
      displayLabel,
      // supplyAreaM2는 "이 chip이 검증된 데이터를 근거로 한다"는 게이트로 쓰인다
      // (AreaChip.tsx의 shouldShowPyeongLabel) — pyeongLabel이 있을 때만 non-null로
      // 채워 보조 캡션(충돌 해소/평형없음 안내)이 정상 렌더되게 한다.
      supplyAreaM2: pyeongLabel != null ? parsedArea : null,
      pyeongLabel,
      tradeCount: countByArea.get(area) || 0,
    };
  };

  return (
    <div style={{ position: 'relative' }}>
      <div 
        style={{ 
          display: 'flex', 
          gap: '0.5rem', 
          flexWrap: 'nowrap', 
          overflowX: 'auto', 
          paddingBottom: '0.25rem',
          scrollbarWidth: 'none', // Firefox
          msOverflowStyle: 'none', // IE/Edge
        }}
        className="no-scrollbar"
      >
        <Chip active={selectedArea === '전체'} onClick={() => onSelect('전체')}>전체</Chip>
        {chipAreas.map((area) => (
          <AreaChip key={area} data={toAreaChipData(area)} active={selectedArea === area} onClick={() => onSelect(area)} />
        ))}
        {allAreas.length > 0 && (
          <Chip dashed onClick={() => setIsOpen(true)}>▼ 전체 평형</Chip>
        )}
      </div>
      
      {/* Right Edge Fade Hint for Horizontal Scroll */}
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: '0.25rem',
        width: '32px',
        background: 'linear-gradient(to right, rgba(255,255,255,0), rgba(255,255,255,1) 80%)',
        pointerEvents: 'none',
      }} />

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
              {allAreas.map((area) => {
                let mainLabel = renderAreaLabel(area);
                let subLabel = `(${countByArea.get(area) || 0}건)`;
                
                if (hasUnitMaster) {
                  const unit = unitMaster.find(u => u.canonicalExclusiveArea === area);
                  if (unit) {
                    const households = (unit.householdCount && unit.householdCount > 0) ? ` · ${unit.householdCount}세대` : '';
                    
                    if (areaUnit === '평' && unit.representativePyeong) {
                      mainLabel = `${unit.representativePyeong}평 · 전용 ${unit.displayExclusiveArea}㎡${households}`;
                      subLabel = '';
                    } else if (areaUnit === '평') {
                      // §9 partial coverage — 이 area만 trustworthy pyeong이 없는 경우도
                      // 정직하게 안내(fake 계산 없이 raw ㎡ 유지).
                      mainLabel = `전용 ${unit.displayExclusiveArea}㎡${households}`;
                      subLabel = '평형 정보 없음';
                    } else {
                      mainLabel = `전용 ${unit.displayExclusiveArea}㎡${households}`;
                      subLabel = '';
                    }
                  }
                }

                return (
                  <button
                    key={area}
                    onClick={() => { onSelect(area); setIsOpen(false); }}
                    style={{
                      padding: '0.75rem 1rem', borderRadius: '8px', textAlign: 'left', border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600,
                      backgroundColor: selectedArea === area ? 'var(--primary-color)' : 'white',
                      color: selectedArea === area ? 'white' : 'var(--text-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                    }}
                  >
                    <span>{mainLabel}</span>
                    {subLabel && <span style={{ fontWeight: 400, opacity: 0.7, fontSize: '0.9rem' }}>{subLabel}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
