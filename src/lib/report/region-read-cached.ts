// REGIONAL_SEO_DATA_AWARE_DESCRIPTION_PATCH_V1 — 한 요청 안에서 지역 리포트를 한 번만 읽는다.
//
// generateMetadata(설명 문구가 실제 섹션 값을 봐야 한다)와 page(시트 렌더)가 같은 envelope을 쓴다.
// Next 16 문서(Metadata §Memoizing data requests)대로 React `cache`로 감싸, 기본 기간 요청에서는
// 조회가 한 번만 일어난다. 집계·스코프 규칙은 readRegionReport 그대로다(이 파일은 기억만 한다).
//
// 인자는 원시값만 받는다 — React cache는 인자 동일성으로 적중을 판단한다.

import { cache } from 'react';
import { readRegionReport } from './region-read';
import type { RegionLevel } from './region-report';
import { resolveReportPeriod, type ReportPeriodKey } from './report-period';

// STATS_PERIOD_IMAGE_PARITY_V2 — 일수(30/90/365) 대신 기간 키를 받는다. 통계 화면에서 온 '7d'·'15d'·'yesterday'
// 같은 키가 30일로 바뀌지 않고 같은 날짜 범위로 읽힌다(report-period.ts).
export const readRegionReportForPeriod = cache(
  async (level: RegionLevel, lawdCd: string | null, dong: string | null, periodKey: ReportPeriodKey) => {
    const period = resolveReportPeriod(periodKey);
    return readRegionReport({
      level,
      lawdCd,
      dong,
      start: period.start,
      end: period.end,
      periodLabel: period.label,
      periodMeta: { key: period.key, singleDay: period.singleDay, isDefault: period.isDefault },
    });
  }
);
