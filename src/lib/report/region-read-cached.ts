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
import { resolvePeriod } from './report-period';

export const readRegionReportForPeriod = cache(
  async (level: RegionLevel, lawdCd: string | null, dong: string | null, days: number) => {
    const period = resolvePeriod(days);
    return readRegionReport({
      level,
      lawdCd,
      dong,
      start: period.start,
      end: period.end,
      periodLabel: period.label,
    });
  }
);
