'use client';

import React from 'react';
import Empty from '@/components/ui/Empty';
import { useRegion } from '@/contexts/RegionContext';
import { getStatsEnabledSidoCodes } from '@/lib/region/enablement';
import { getSido } from '@/lib/region/registry';
import { STATS_UNSUPPORTED_MESSAGE } from '@/lib/region/stats-gate';
import { buildRegionDisplayName } from '@/lib/region-display-name';
import styles from './StatsUnsupportedRegion.module.css';

// NON_BUSAN_STATS_TRUST_GATE_V1 — 통계가 아직 열리지 않은 지역의 공통 안내.
// 오류(ErrorState)도, "거래가 없어요"(noData)도 아니다 — 준비 중(notReady)이다.
// 다른 지역의 데이터를 대신 보여주지 않는다. 열려 있는 지역으로의 이동은 사용자가 버튼으로만 한다.
export default function StatsUnsupportedRegion({
  displayRegionName,
  onSelectSupportedSido,
}: {
  displayRegionName?: string | null;
  /** 지역 상태를 RegionContext가 아닌 URL로 관리하는 화면(변동지도)용. 없으면 RegionContext를 바꾼다. */
  onSelectSupportedSido?: (sidoCode: string) => void;
}) {
  const { setRegion } = useRegion();
  const supported = getSido(getStatsEnabledSidoCodes()[0]);
  const regionPrefix = displayRegionName ? `${displayRegionName} ` : '';

  const goToSupported = () => {
    if (!supported) return;
    if (onSelectSupportedSido) {
      onSelectSupportedSido(supported.code);
      return;
    }
    setRegion({
      lawdCd: null,
      sidoCode: supported.code,
      dong: 'all',
      sido: supported.name,
      sigungu: '',
      displayRegionName: buildRegionDisplayName({ sido: supported.name, sigungu: '', dong: 'all' }),
    });
  };

  return (
    <div className={styles.wrap} role="status">
      <Empty
        variant="notReady"
        title={STATS_UNSUPPORTED_MESSAGE}
        description={
          supported
            ? `${regionPrefix}통계는 믿을 수 있는 실거래 데이터가 준비되면 열어드릴게요. 지금은 ${supported.name} 통계를 제공하고 있어요.`
            : `${regionPrefix}통계는 믿을 수 있는 실거래 데이터가 준비되면 열어드릴게요.`
        }
      />
      {supported && (
        <button type="button" className={styles.cta} onClick={goToSupported}>
          {supported.name} 통계 보기
        </button>
      )}
    </div>
  );
}
