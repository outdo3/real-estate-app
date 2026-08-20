'use client';

import React from 'react';
import Chip from './Chip';
import styles from './AreaChip.module.css';
import { shouldShowPyeongLabel } from '@/lib/area-chip-rules';

// [AREA MODEL V1 §19] 오늘 실제로 채울 수 있는 필드만 반영한 최소 contract.
// supplyAreaM2가 null이면(오늘 사실상 전체 케이스) pyeongLabel도 반드시
// null이어야 한다 — "34평형" 같은 미검증 공급평형 라벨을 만들지 않는다.
export interface AreaChipData {
  id: string;
  exclusiveAreaM2: number;
  displayLabel: string;
  supplyAreaM2: number | null;
  pyeongLabel: string | null;
  tradeCount: number;
}

interface AreaChipProps {
  data: AreaChipData;
  active: boolean;
  onClick: () => void;
  dashed?: boolean;
  showTradeCount?: boolean;
}

export default function AreaChip({ data, active, onClick, dashed, showTradeCount }: AreaChipProps) {
  if (process.env.NODE_ENV !== 'production' && data.supplyAreaM2 === null && data.pyeongLabel) {
    // [AREA MODEL V1 §16] 공급면적 미검증 상태에서 평형 라벨이 들어오면 계약
    // 위반이다 — 조용히 숨기지 않고 개발 중에 바로 드러나게 한다.
    console.warn(`[AreaChip] supplyAreaM2 is null but pyeongLabel is set ("${data.pyeongLabel}") for id=${data.id}. 평형 표기는 검증된 공급면적이 있을 때만 허용된다.`);
  }

  return (
    <Chip active={active} dashed={dashed} onClick={onClick}>
      <span className={styles.label}>{data.displayLabel}</span>
      {/* supplyAreaM2가 검증된 경우에만 pyeongLabel이 채워진다 — 이 컴포넌트는
          평형 문자열을 스스로 만들지 않고 상위에서 준 값만 그대로 노출한다. */}
      {shouldShowPyeongLabel(data) && (
        <span className={styles.pyeong}>{data.pyeongLabel}</span>
      )}
      {showTradeCount && data.tradeCount > 0 && (
        <span className={styles.tradeCount}>({data.tradeCount})</span>
      )}
    </Chip>
  );
}
